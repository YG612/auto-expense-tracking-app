#import <CommonCrypto/CommonDigest.h>
#import <React/RCTBridgeModule.h>

#include <memory>
#include <string>

#include "../../native/bill-classifier/OnDeviceBillClassifierCore.h"

using qingji::classification::OnDeviceBillClassifierCore;

@interface OnDeviceBillClassifier : NSObject <RCTBridgeModule> {
  std::unique_ptr<OnDeviceBillClassifierCore> _core;
  NSDictionary *_metadata;
  NSString *_loadFailure;
}
@end

@implementation OnDeviceBillClassifier

RCT_EXPORT_MODULE(OnDeviceBillClassifier)

+ (BOOL)requiresMainQueueSetup { return NO; }

- (dispatch_queue_t)methodQueue {
  return dispatch_queue_create(
      "com.qingjiai.bill-classifier", DISPATCH_QUEUE_SERIAL);
}

- (NSString *)sha256ForFile:(NSString *)path {
  NSInputStream *stream = [NSInputStream inputStreamWithFileAtPath:path];
  if (stream == nil) return nil;
  [stream open];
  CC_SHA256_CTX context;
  CC_SHA256_Init(&context);
  uint8_t buffer[64 * 1024];
  while ([stream hasBytesAvailable]) {
    NSInteger count = [stream read:buffer maxLength:sizeof(buffer)];
    if (count < 0) {
      [stream close];
      return nil;
    }
    if (count == 0) break;
    CC_SHA256_Update(&context, buffer, (CC_LONG)count);
  }
  [stream close];
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(digest, &context);
  NSMutableString *hex = [NSMutableString stringWithCapacity:64];
  for (NSUInteger index = 0; index < sizeof(digest); index++) {
    [hex appendFormat:@"%02x", digest[index]];
  }
  return hex;
}

- (BOOL)loadIfNeeded:(NSError **)error {
  if (_core != nullptr) return YES;
  if (_loadFailure != nil) {
    if (error != nullptr) {
      *error = [NSError errorWithDomain:@"QingJiBillClassifier"
                                   code:1
                               userInfo:@{NSLocalizedDescriptionKey : _loadFailure}];
    }
    return NO;
  }
  @try {
    NSString *directory = [[NSBundle mainBundle] pathForResource:@"bill-classifier"
                                                          ofType:nil];
    if (directory == nil) @throw @"Model directory is missing.";
    NSString *manifestPath = [directory stringByAppendingPathComponent:@"manifest.json"];
    NSData *data = [NSData dataWithContentsOfFile:manifestPath];
    if (data == nil) @throw @"Model manifest is missing.";
    NSDictionary *manifest = [NSJSONSerialization JSONObjectWithData:data
                                                              options:0
                                                                error:error];
    if (manifest == nil || ![manifest[@"schemaVersion"] isEqual:@1]) {
      @throw @"Model manifest is invalid.";
    }
    NSRegularExpression *modelName = [NSRegularExpression
        regularExpressionWithPattern:@"^(parent-(expense|income)|child-expense\\.[a-z_]+)\\.ftz$"
                              options:0
                                error:error];
    for (NSDictionary *spec in manifest[@"models"]) {
      NSString *name = spec[@"name"];
      if (![name isKindOfClass:[NSString class]] ||
          [modelName numberOfMatchesInString:name options:0
                                      range:NSMakeRange(0, name.length)] != 1) {
        @throw @"Model asset name is invalid.";
      }
      NSString *path = [directory stringByAppendingPathComponent:name];
      NSDictionary *attributes = [[NSFileManager defaultManager]
          attributesOfItemAtPath:path error:error];
      if (attributes == nil ||
          ![attributes[NSFileSize] isEqual:spec[@"sizeBytes"]] ||
          ![[self sha256ForFile:path] isEqual:spec[@"sha256"]]) {
        @throw @"Model asset failed integrity verification.";
      }
    }
    _metadata = @{
      @"modelId" : manifest[@"modelId"],
      @"modelVersion" : manifest[@"modelVersion"],
      @"taxonomyVersion" : manifest[@"taxonomyVersion"],
    };
    _core = std::make_unique<OnDeviceBillClassifierCore>(
        std::string(directory.UTF8String));
    return YES;
  } @catch (id failure) {
    _loadFailure = [failure isKindOfClass:[NSString class]]
        ? failure
        : @"On-device model could not be loaded.";
    if (error != nullptr) {
      *error = [NSError errorWithDomain:@"QingJiBillClassifier"
                                   code:2
                               userInfo:@{NSLocalizedDescriptionKey : _loadFailure}];
    }
    return NO;
  }
}

RCT_REMAP_METHOD(getStatus,
                 getStatusWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSError *error = nil;
  BOOL loaded = [self loadIfNeeded:&error];
  NSMutableDictionary *status = [@{
    @"available" : @(loaded),
    @"loaded" : @(loaded),
  } mutableCopy];
  if (_metadata != nil) [status addEntriesFromDictionary:_metadata];
  if (error != nil) status[@"reason"] = error.localizedDescription;
  resolve(status);
}

RCT_REMAP_METHOD(classify,
                 classifyText:(NSString *)text
                 transactionType:(NSString *)transactionType
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  if (text.length == 0 || text.length > 500 ||
      !([transactionType isEqualToString:@"EXPENSE"] ||
        [transactionType isEqualToString:@"INCOME"])) {
    reject(@"bill-classifier-input", @"Classification input is invalid.", nil);
    return;
  }
  NSError *error = nil;
  if (![self loadIfNeeded:&error]) {
    reject(@"bill-classifier-unavailable", error.localizedDescription, error);
    return;
  }
  try {
    const auto result = _core->classify(std::string(text.UTF8String),
                                        std::string(transactionType.UTF8String));
    NSMutableDictionary *payload = [_metadata mutableCopy];
    if (!result.parentCategoryKey.empty()) {
      payload[@"parentCategoryKey"] =
          [NSString stringWithUTF8String:result.parentCategoryKey.c_str()];
    }
    if (!result.subcategoryKey.empty()) {
      payload[@"subcategoryKey"] =
          [NSString stringWithUTF8String:result.subcategoryKey.c_str()];
    }
    payload[@"top1Probability"] = @(result.top1Probability);
    payload[@"top2Probability"] = @(result.top2Probability);
    payload[@"calibratedConfidence"] = @(result.calibratedConfidence);
    payload[@"abstained"] = @(result.abstained);
    if (!result.reason.empty()) {
      payload[@"reason"] =
          [NSString stringWithUTF8String:result.reason.c_str()];
    }
    payload[@"latencyMs"] = @(result.latencyMs);
    resolve(payload);
  } catch (const std::exception& exception) {
    reject(@"bill-classifier-failed", @"On-device classification failed.",
           [NSError errorWithDomain:@"QingJiBillClassifier"
                               code:3
                           userInfo:@{NSLocalizedDescriptionKey : @(exception.what())}]);
  }
}

RCT_REMAP_METHOD(close,
                 closeWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  _core.reset();
  resolve(nil);
}

@end
