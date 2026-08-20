#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LedgerFilePortal, NSObject)

RCT_EXTERN_METHOD(saveText:(NSString *)suggestedFileName
                  mimeType:(NSString *)mimeType
                  content:(NSString *)content
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(openText:(NSArray<NSString *> *)mimeTypes
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
