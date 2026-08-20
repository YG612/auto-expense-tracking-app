#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LedgerBackupCrypto, NSObject)

RCT_EXTERN_METHOD(encrypt:(NSString *)plaintext
                  passphrase:(NSString *)passphrase
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(decrypt:(NSString *)envelope
                  passphrase:(NSString *)passphrase
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
