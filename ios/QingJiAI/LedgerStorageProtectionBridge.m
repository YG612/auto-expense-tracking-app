#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LedgerStorageProtection, NSObject)

RCT_EXTERN_METHOD(applyProtection:(NSString *)databasePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
