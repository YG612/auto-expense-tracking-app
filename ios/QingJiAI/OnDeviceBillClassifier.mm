#import <CommonCrypto/CommonDigest.h>
#import <React/RCTBridgeModule.h>
#import <TargetConditionals.h>
#import <UIKit/UIKit.h>

#include <mach/mach.h>
#include <sys/sysctl.h>

#include <memory>
#include <string>

#include "../../native/bill-classifier/OnDeviceBillClassifierCore.h"

using qingji::classification::OnDeviceBillClassifierCore;

@interface OnDeviceBillClassifier : NSObject <RCTBridgeModule> {
  std::unique_ptr<OnDeviceBillClassifierCore> _core;
  NSDictionary *_metadata;
  NSDictionary *_categoryPolicies;
  NSDictionary *_counterpartyMetadata;
  NSString *_deploymentMode;
  NSString *_manifestSha256;
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
    NSNumber *schemaVersion = manifest[@"schemaVersion"];
    if (manifest == nil || schemaVersion.integerValue < 1 ||
        schemaVersion.integerValue > 2) {
      @throw @"Model manifest is invalid.";
    }
    if (schemaVersion.integerValue == 2 &&
        manifest[@"candidateStatus"] != nil) {
      @throw @"Unapproved candidate models cannot be loaded.";
    }
    if (schemaVersion.integerValue == 2) {
      NSDictionary *deployment = manifest[@"deployment"];
      NSRegularExpression *sha256Hex = [NSRegularExpression
          regularExpressionWithPattern:@"^[a-f0-9]{64}$"
                                options:0
                                  error:error];
      NSString *mode = deployment[@"mode"];
      if ([deployment[@"allowAutoCommit"] boolValue]) {
        @throw @"Unified model deployment cannot enable automatic commits.";
      }
      NSDictionary *evidence = nil;
      if ([mode isEqualToString:@"SHADOW"]) {
        evidence = @{
          @"selection_report.json": @"selectionReportSha256",
          @"MODEL_SELECTION_COMPLETE.json": @"completionReceiptSha256",
          @"shadow-activation.json": @"activationSha256",
        };
      } else if ([mode isEqualToString:@"BENCHMARK_ONLY"]) {
        evidence = @{
          @"candidate-manifest.json": @"candidateManifestSha256",
          @"evaluation-report.json": @"evaluationReportSha256",
          @"error_slices.json": @"errorSlicesSha256",
          @"frozen-evaluation-lock.json": @"frozenLockSha256",
        };
      } else {
        @throw @"Unsupported unified model deployment mode.";
      }
      _deploymentMode = mode;
      for (NSString *name in evidence) {
        NSString *expectedHash = deployment[evidence[name]];
        NSString *evidencePath = [directory stringByAppendingPathComponent:name];
        if (![expectedHash isKindOfClass:[NSString class]] ||
            [sha256Hex numberOfMatchesInString:expectedHash options:0
                                         range:NSMakeRange(0, expectedHash.length)] != 1 ||
            ![[self sha256ForFile:evidencePath] isEqual:expectedHash]) {
          @throw @"Unified model deployment evidence failed integrity verification.";
        }
      }
    }
    if (schemaVersion.integerValue == 2) {
      _categoryPolicies = manifest[@"categoryPolicies"];
      NSSet *expectedLabels = [NSSet setWithArray:@[
        @"income", @"expense.food", @"expense.transport",
        @"expense.shopping", @"expense.housing",
        @"expense.entertainment", @"expense.healthcare",
        @"expense.education", @"expense.other_expense"
      ]];
      if (![_categoryPolicies isKindOfClass:[NSDictionary class]] ||
          ![[NSSet setWithArray:_categoryPolicies.allKeys]
              isEqualToSet:expectedLabels] ||
          [_categoryPolicies[@"expense.other_expense"][@"enabled"] boolValue]) {
        @throw @"Unified category policies are invalid.";
      }
      for (NSString *label in expectedLabels) {
        NSDictionary *policy = _categoryPolicies[label];
        NSNumber *enabled = policy[@"enabled"];
        if (![policy isKindOfClass:[NSDictionary class]] ||
            ![enabled isKindOfClass:[NSNumber class]] ||
            (enabled.boolValue &&
             (![policy[@"confidenceThreshold"] isKindOfClass:[NSNumber class]] ||
              ![policy[@"marginThreshold"] isKindOfClass:[NSNumber class]]))) {
          @throw @"Unified category policy is malformed.";
        }
      }
    } else {
      _categoryPolicies = @{};
      _deploymentMode = @"LEGACY";
    }
    NSRegularExpression *modelName = [NSRegularExpression
        regularExpressionWithPattern:@"^(category-v3|parent-(expense|income)|child-expense\\.[a-z_]+)\\.ftz$"
                              options:0
                                error:error];
    NSArray *models = manifest[@"models"];
    NSUInteger expectedModelCount = schemaVersion.integerValue == 2 ? 1 : 15;
    if (![models isKindOfClass:[NSArray class]] ||
        models.count != expectedModelCount) {
      @throw @"Model asset count is invalid.";
    }
    for (NSDictionary *spec in models) {
      NSString *name = spec[@"name"];
      if (![name isKindOfClass:[NSString class]] ||
          [modelName numberOfMatchesInString:name options:0
                                      range:NSMakeRange(0, name.length)] != 1) {
        @throw @"Model asset name is invalid.";
      }
      if (schemaVersion.integerValue == 2 &&
          ![name isEqualToString:@"category-v3.ftz"]) {
        @throw @"Unified model asset name is invalid.";
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
    NSDictionary *counterparty = manifest[@"counterpartyModel"];
    NSString *counterpartyName = counterparty[@"name"];
    NSString *counterpartyPath =
        [directory stringByAppendingPathComponent:@"counterparty-candidate-v1.ftz"];
    NSDictionary *counterpartyAttributes = [[NSFileManager defaultManager]
        attributesOfItemAtPath:counterpartyPath error:error];
    if (![counterparty isKindOfClass:[NSDictionary class]] ||
        ![counterpartyName isEqualToString:@"counterparty-candidate-v1.ftz"] ||
        ![counterparty[@"modelVersion"] isKindOfClass:[NSString class]] ||
        ![counterparty[@"threshold"] isKindOfClass:[NSNumber class]] ||
        counterpartyAttributes == nil ||
        ![counterpartyAttributes[NSFileSize]
            isEqual:counterparty[@"sizeBytes"]] ||
        ![[self sha256ForFile:counterpartyPath]
            isEqual:counterparty[@"sha256"]]) {
      @throw @"Counterparty model asset failed integrity verification.";
    }
    _counterpartyMetadata = counterparty;
    _metadata = @{
      @"modelId" : manifest[@"modelId"],
      @"modelVersion" : manifest[@"modelVersion"],
      @"taxonomyVersion" : manifest[@"taxonomyVersion"],
      @"deploymentMode" : _deploymentMode,
    };
    _manifestSha256 = [self sha256ForFile:manifestPath];
    NSDictionary *thresholds = manifest[@"thresholds"];
    NSNumber *confidence = schemaVersion.integerValue == 2
        ? thresholds[@"unifiedConfidence"]
        : @0.75;
    NSNumber *margin = schemaVersion.integerValue == 2
        ? thresholds[@"unifiedMargin"]
        : @0.12;
    NSNumber *temperature = schemaVersion.integerValue == 2
        ? manifest[@"calibrationTemperature"]
        : @1.0;
    _core = std::make_unique<OnDeviceBillClassifierCore>(
        std::string(directory.UTF8String), confidence.floatValue,
        margin.floatValue, temperature.floatValue);
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

- (NSMutableDictionary *)classificationPayloadForText:(NSString *)text
                                      transactionType:(NSString *)transactionType {
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
  payload[@"calibratedTop2Probability"] =
      @(result.calibratedTop2Probability);
  BOOL abstained = result.abstained;
  NSString *reason = result.reason.empty()
      ? nil
      : [NSString stringWithUTF8String:result.reason.c_str()];
  if (!abstained && _categoryPolicies.count > 0 &&
      !result.parentCategoryKey.empty()) {
    NSString *label =
        [NSString stringWithUTF8String:result.parentCategoryKey.c_str()];
    NSDictionary *policy = _categoryPolicies[label];
    if (![policy[@"enabled"] boolValue]) {
      abstained = YES;
      reason = @"CATEGORY_DISABLED";
    } else if (result.calibratedConfidence <
                   [policy[@"confidenceThreshold"] floatValue] ||
               result.calibratedConfidence -
                       result.calibratedTop2Probability <
                   [policy[@"marginThreshold"] floatValue]) {
      abstained = YES;
      reason = @"CATEGORY_THRESHOLD";
    }
  }
  payload[@"abstained"] = @(abstained);
  if (reason != nil) payload[@"reason"] = reason;
  payload[@"latencyMs"] = @(result.latencyMs);
  return payload;
}

- (NSNumber *)physicalFootprintMb {
  task_vm_info_data_t info;
  mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
  kern_return_t status = task_info(
      mach_task_self_, TASK_VM_INFO, reinterpret_cast<task_info_t>(&info),
      &count);
  if (status != KERN_SUCCESS) return nil;
  return @((double)info.phys_footprint / (1024.0 * 1024.0));
}

- (NSString *)hardwareModel {
  size_t size = 0;
  if (sysctlbyname("hw.machine", nullptr, &size, nullptr, 0) != 0 ||
      size == 0) {
    return UIDevice.currentDevice.model;
  }
  std::string value(size, '\0');
  if (sysctlbyname("hw.machine", value.data(), &size, nullptr, 0) != 0) {
    return UIDevice.currentDevice.model;
  }
  if (!value.empty() && value.back() == '\0') value.pop_back();
  return [NSString stringWithUTF8String:value.c_str()];
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
    resolve([self classificationPayloadForText:text
                               transactionType:transactionType]);
  } catch (const std::exception& exception) {
    reject(@"bill-classifier-failed", @"On-device classification failed.",
           [NSError errorWithDomain:@"QingJiBillClassifier"
                               code:3
                           userInfo:@{NSLocalizedDescriptionKey : @(exception.what())}]);
  }
}

RCT_REMAP_METHOD(scoreCounterpartyCandidates,
                 scoreCounterpartyCandidateTexts:(NSArray *)modelTexts
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  if (![modelTexts isKindOfClass:[NSArray class]] || modelTexts.count == 0 ||
      modelTexts.count > 64) {
    reject(@"counterparty-classifier-input",
           @"Counterparty candidate input is invalid.", nil);
    return;
  }
  NSError *error = nil;
  if (![self loadIfNeeded:&error]) {
    reject(@"counterparty-classifier-unavailable", error.localizedDescription,
           error);
    return;
  }
  NSMutableArray *output = [NSMutableArray arrayWithCapacity:modelTexts.count];
  try {
    for (id value in modelTexts) {
      if (![value isKindOfClass:[NSString class]] ||
          [(NSString *)value length] == 0 || [(NSString *)value length] > 2000) {
        reject(@"counterparty-classifier-input",
               @"Counterparty candidate text is invalid.", nil);
        return;
      }
      const auto score = _core->scoreCounterpartyCandidate(
          std::string([(NSString *)value UTF8String]));
      [output addObject:@{
        @"primaryProbability" : @(score.primaryProbability),
        @"notCounterpartyProbability" : @(score.notCounterpartyProbability),
        @"latencyMs" : @(score.latencyMs),
        @"threshold" : _counterpartyMetadata[@"threshold"],
        @"modelVersion" : _counterpartyMetadata[@"modelVersion"],
      }];
    }
    resolve(output);
  } catch (const std::exception& exception) {
    reject(@"counterparty-classifier-failed",
           @"Counterparty classification failed.",
           [NSError errorWithDomain:@"QingJiBillClassifier"
                               code:4
                           userInfo:@{NSLocalizedDescriptionKey : @(exception.what())}]);
  }
}

RCT_REMAP_METHOD(runBenchmarkIfRequested,
                 runBenchmarkIfRequestedWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  if (![[NSProcessInfo processInfo].arguments
          containsObject:@"--qingji-bill-classifier-benchmark"]) {
    resolve(@{ @"ran" : @NO });
    return;
  }
#if TARGET_OS_SIMULATOR
  reject(@"bill-classifier-benchmark-simulator",
         @"The iOS classifier benchmark requires a physical device.", nil);
  return;
#endif
  if (_core != nullptr) {
    reject(@"bill-classifier-benchmark-state",
           @"The benchmark must run before the classifier is loaded.", nil);
    return;
  }
  NSMutableArray *baselineMemory = [NSMutableArray arrayWithCapacity:3];
  for (NSUInteger index = 0; index < 3; index++) {
    NSNumber *sample = [self physicalFootprintMb];
    if (sample == nil) {
      reject(@"bill-classifier-benchmark-memory",
             @"Could not read the baseline iOS physical footprint.", nil);
      return;
    }
    [baselineMemory addObject:sample];
  }
  NSError *error = nil;
  if (![self loadIfNeeded:&error]) {
    reject(@"bill-classifier-unavailable", error.localizedDescription, error);
    return;
  }
  if (![_deploymentMode isEqualToString:@"BENCHMARK_ONLY"]) {
    reject(@"bill-classifier-benchmark-mode",
           @"The iOS benchmark requires BENCHMARK_ONLY assets.", nil);
    return;
  }
  NSString *documents = [NSSearchPathForDirectoriesInDomains(
      NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
  NSString *inputPath =
      [documents stringByAppendingPathComponent:@"golden-input.tsv"];
  NSString *goldenPath =
      [documents stringByAppendingPathComponent:@"ios-golden.jsonl"];
  NSString *evidencePath =
      [documents stringByAppendingPathComponent:@"ios-device-evidence.json"];
  NSString *contents = [NSString stringWithContentsOfFile:inputPath
                                                  encoding:NSUTF8StringEncoding
                                                     error:&error];
  if (contents == nil) {
    reject(@"bill-classifier-benchmark-input",
           @"golden-input.tsv is missing from the app Documents directory.",
           error);
    return;
  }
  NSMutableData *goldenData = [NSMutableData data];
  NSUInteger vectorCount = 0;
  try {
    @try {
      for (NSString *rawLine in
           [contents componentsSeparatedByCharactersInSet:
                         NSCharacterSet.newlineCharacterSet]) {
        NSString *line = [rawLine
            stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        if (line.length == 0) continue;
        NSArray<NSString *> *fields = [line componentsSeparatedByString:@"\t"];
        if (fields.count != 3 || fields[0].length == 0 ||
            fields[2].length == 0 ||
            !([fields[1] isEqualToString:@"EXPENSE"] ||
              [fields[1] isEqualToString:@"INCOME"])) {
          @throw @"Malformed golden-input.tsv row.";
        }
        NSMutableDictionary *payload =
            [self classificationPayloadForText:fields[2]
                               transactionType:fields[1]];
        NSMutableDictionary *row = [@{
          @"id" : fields[0],
          @"abstained" : payload[@"abstained"],
          @"latencyMs" : payload[@"latencyMs"],
        } mutableCopy];
        if (payload[@"parentCategoryKey"] != nil) {
          row[@"parentCategoryKey"] = payload[@"parentCategoryKey"];
        }
        row[@"reason"] = payload[@"reason"] ?: NSNull.null;
        NSData *rowData = [NSJSONSerialization dataWithJSONObject:row
                                                          options:0
                                                            error:&error];
        if (rowData == nil) @throw @"Could not encode an iOS golden row.";
        [goldenData appendData:rowData];
        [goldenData appendBytes:"\n" length:1];
        vectorCount += 1;
      }
    } @catch (id failure) {
      NSString *message = [failure isKindOfClass:[NSString class]]
          ? failure
          : @"The iOS benchmark input could not be processed.";
      reject(@"bill-classifier-benchmark-failed", message, error);
      return;
    }
  } catch (const std::exception& exception) {
    reject(@"bill-classifier-benchmark-failed",
           @"On-device classification failed during the iOS benchmark.",
           [NSError errorWithDomain:@"QingJiBillClassifier"
                               code:4
                           userInfo:@{
                             NSLocalizedDescriptionKey : @(exception.what())
                           }]);
    return;
  }
  if (vectorCount < 100 ||
      ![goldenData writeToFile:goldenPath
                       options:NSDataWritingAtomic
                         error:&error]) {
    reject(@"bill-classifier-benchmark-output",
           @"The iOS benchmark did not produce 100 durable golden vectors.",
           error);
    return;
  }
  NSMutableArray *candidateMemory = [NSMutableArray arrayWithCapacity:3];
  for (NSUInteger index = 0; index < 3; index++) {
    NSNumber *sample = [self physicalFootprintMb];
    if (sample == nil) {
      reject(@"bill-classifier-benchmark-memory",
             @"Could not read the candidate iOS physical footprint.", nil);
      return;
    }
    [candidateMemory addObject:sample];
  }
  NSDictionary *evidence = @{
    @"schemaVersion" : @1,
    @"source" : @"IOS_ARM64_BENCHMARK_ONLY_APP",
    @"deploymentMode" : @"BENCHMARK_ONLY",
    @"allowAutoCommit" : @NO,
    @"modelManifestSha256" : _manifestSha256,
    @"modelVersion" : _metadata[@"modelVersion"],
    @"goldenSha256" : [self sha256ForFile:goldenPath],
    @"goldenVectorCount" : @(vectorCount),
    @"device" : @{
      @"platform" : @"ios",
      @"physicalDevice" : @YES,
      @"hardwareModel" : [self hardwareModel],
      @"systemName" : UIDevice.currentDevice.systemName,
      @"systemVersion" : UIDevice.currentDevice.systemVersion,
    },
    @"baselineMemoryMb" : baselineMemory,
    @"candidateMemoryMb" : candidateMemory,
    @"generatedAt" :
        [[NSISO8601DateFormatter new] stringFromDate:[NSDate date]],
  };
  NSData *evidenceData =
      [NSJSONSerialization dataWithJSONObject:evidence
                                      options:NSJSONWritingPrettyPrinted
                                        error:&error];
  if (evidenceData == nil ||
      ![evidenceData writeToFile:evidencePath
                         options:NSDataWritingAtomic
                           error:&error]) {
    reject(@"bill-classifier-benchmark-evidence",
           @"Could not persist the iOS benchmark evidence.", error);
    return;
  }
  resolve(@{
    @"ran" : @YES,
    @"goldenPath" : goldenPath,
    @"evidencePath" : evidencePath,
    @"vectorCount" : @(vectorCount),
  });
}

RCT_REMAP_METHOD(close,
                 closeWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  _core.reset();
  resolve(nil);
}

@end
