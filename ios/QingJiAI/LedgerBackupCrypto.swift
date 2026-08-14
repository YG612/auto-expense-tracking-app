import CommonCrypto
import CryptoKit
import Foundation
import React
import Security

@objc(LedgerBackupCrypto)
final class LedgerBackupCrypto: NSObject {
  private enum Contract {
    static let format = "qingji-ai-encrypted-backup"
    static let formatVersion = 1
    static let kdfAlgorithm = "PBKDF2-HMAC-SHA256"
    static let cipherAlgorithm = "AES-256-GCM"
    static let iterations = 310_000
    static let saltBytes = 16
    static let nonceBytes = 12
    static let tagBytes = 16
    static let keyBytes = 32
    static let minimumPassphraseCharacters = 8
    static let maximumPassphraseCharacters = 256
    static let maximumPlaintextBytes = 32 * 1024 * 1024
    static let maximumEnvelopeBytes = 50 * 1024 * 1024
    static let associatedData = Data(
      "\(format):\(formatVersion):\(kdfAlgorithm):\(iterations):\(cipherAlgorithm)".utf8
    )
  }

  private enum CryptoError: LocalizedError {
    case invalidInput
    case randomFailure
    case derivationFailure
    case invalidEnvelope
    case decryptionFailure

    var errorDescription: String? {
      switch self {
      case .invalidInput:
        return "The encrypted backup input is invalid."
      case .randomFailure:
        return "Secure random data could not be generated."
      case .derivationFailure:
        return "The backup encryption key could not be derived."
      case .invalidEnvelope:
        return "The encrypted ledger backup format is invalid."
      case .decryptionFailure:
        return "The passphrase is incorrect or the backup was modified."
      }
    }
  }

  private let cryptoQueue = DispatchQueue(
    label: "com.qingjiai.ledger-backup-crypto",
    qos: .userInitiated
  )

  @objc static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(encrypt:passphrase:resolver:rejecter:)
  func encrypt(
    _ plaintext: String,
    passphrase: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    cryptoQueue.async {
      do {
        try self.validatePassphrase(passphrase)
        let plaintextData = Data(plaintext.utf8)
        guard
          !plaintextData.isEmpty,
          plaintextData.count <= Contract.maximumPlaintextBytes
        else {
          throw CryptoError.invalidInput
        }

        let salt = try self.randomData(count: Contract.saltBytes)
        let nonceData = try self.randomData(count: Contract.nonceBytes)
        var derivedKey = try self.deriveKey(passphrase: passphrase, salt: salt)
        defer { derivedKey.resetBytes(in: 0..<derivedKey.count) }

        let nonce = try AES.GCM.Nonce(data: nonceData)
        let sealed = try AES.GCM.seal(
          plaintextData,
          using: SymmetricKey(data: derivedKey),
          nonce: nonce,
          authenticating: Contract.associatedData
        )
        let ciphertext = sealed.ciphertext + sealed.tag
        let envelope: [String: Any] = [
          "format": Contract.format,
          "formatVersion": Contract.formatVersion,
          "kdf": [
            "algorithm": Contract.kdfAlgorithm,
            "iterations": Contract.iterations,
            "salt": salt.base64EncodedString(),
          ],
          "cipher": [
            "algorithm": Contract.cipherAlgorithm,
            "nonce": nonceData.base64EncodedString(),
            "ciphertext": ciphertext.base64EncodedString(),
          ],
        ]
        let encoded = try JSONSerialization.data(
          withJSONObject: envelope,
          options: [.sortedKeys]
        )
        guard let result = String(data: encoded, encoding: .utf8) else {
          throw CryptoError.invalidEnvelope
        }
        guard encoded.count <= Contract.maximumEnvelopeBytes else {
          throw CryptoError.invalidEnvelope
        }
        resolve(result)
      } catch {
        reject(
          "ledger-backup-encrypt",
          "The encrypted ledger backup could not be created.",
          error
        )
      }
    }
  }

  @objc(decrypt:passphrase:resolver:rejecter:)
  func decrypt(
    _ envelope: String,
    passphrase: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    cryptoQueue.async {
      do {
        try self.validatePassphrase(passphrase)
        guard
          !envelope.isEmpty,
          let envelopeData = envelope.data(using: .utf8),
          envelopeData.count <= Contract.maximumEnvelopeBytes,
          let root = try JSONSerialization.jsonObject(with: envelopeData) as? [String: Any],
          root["format"] as? String == Contract.format,
          root["formatVersion"] as? Int == Contract.formatVersion,
          let kdf = root["kdf"] as? [String: Any],
          kdf["algorithm"] as? String == Contract.kdfAlgorithm,
          kdf["iterations"] as? Int == Contract.iterations,
          let saltText = kdf["salt"] as? String,
          let salt = Data(base64Encoded: saltText),
          salt.count == Contract.saltBytes,
          let cipher = root["cipher"] as? [String: Any],
          cipher["algorithm"] as? String == Contract.cipherAlgorithm,
          let nonceText = cipher["nonce"] as? String,
          let nonceData = Data(base64Encoded: nonceText),
          nonceData.count == Contract.nonceBytes,
          let ciphertextText = cipher["ciphertext"] as? String,
          let combinedCiphertext = Data(base64Encoded: ciphertextText),
          combinedCiphertext.count >= Contract.tagBytes,
          combinedCiphertext.count <= Contract.maximumPlaintextBytes + Contract.tagBytes
        else {
          throw CryptoError.invalidEnvelope
        }

        let tagStart = combinedCiphertext.count - Contract.tagBytes
        let ciphertext = combinedCiphertext.prefix(tagStart)
        let tag = combinedCiphertext.suffix(Contract.tagBytes)
        var derivedKey = try self.deriveKey(passphrase: passphrase, salt: salt)
        defer { derivedKey.resetBytes(in: 0..<derivedKey.count) }

        do {
          let sealedBox = try AES.GCM.SealedBox(
            nonce: AES.GCM.Nonce(data: nonceData),
            ciphertext: ciphertext,
            tag: tag
          )
          let plaintext = try AES.GCM.open(
            sealedBox,
            using: SymmetricKey(data: derivedKey),
            authenticating: Contract.associatedData
          )
          guard let result = String(data: plaintext, encoding: .utf8) else {
            throw CryptoError.decryptionFailure
          }
          resolve(result)
        } catch {
          throw CryptoError.decryptionFailure
        }
      } catch {
        reject(
          "ledger-backup-decrypt",
          error.localizedDescription,
          error
        )
      }
    }
  }

  private func validatePassphrase(_ value: String) throws {
    guard
      value.count >= Contract.minimumPassphraseCharacters,
      value.count <= Contract.maximumPassphraseCharacters
    else {
      throw CryptoError.invalidInput
    }
  }

  private func randomData(count: Int) throws -> Data {
    var data = Data(count: count)
    let status = data.withUnsafeMutableBytes { buffer in
      SecRandomCopyBytes(kSecRandomDefault, count, buffer.baseAddress!)
    }
    guard status == errSecSuccess else {
      throw CryptoError.randomFailure
    }
    return data
  }

  private func deriveKey(passphrase: String, salt: Data) throws -> Data {
    let password = Data(passphrase.utf8)
    var derived = Data(count: Contract.keyBytes)
    let status = password.withUnsafeBytes { passwordBytes in
      salt.withUnsafeBytes { saltBytes in
        derived.withUnsafeMutableBytes { derivedBytes in
          CCKeyDerivationPBKDF(
            CCPBKDFAlgorithm(kCCPBKDF2),
            passwordBytes.bindMemory(to: Int8.self).baseAddress,
            password.count,
            saltBytes.bindMemory(to: UInt8.self).baseAddress,
            salt.count,
            CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
            UInt32(Contract.iterations),
            derivedBytes.bindMemory(to: UInt8.self).baseAddress,
            Contract.keyBytes
          )
        }
      }
    }
    guard status == kCCSuccess else {
      derived.resetBytes(in: 0..<derived.count)
      throw CryptoError.derivationFailure
    }
    return derived
  }
}
