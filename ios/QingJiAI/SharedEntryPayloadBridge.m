#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(SharedEntryPayload, NSObject)
RCT_EXTERN_METHOD(
  consume:(NSString *)token
  resolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)
RCT_EXTERN_METHOD(
  clear:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)
@end
