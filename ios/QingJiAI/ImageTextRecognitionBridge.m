#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ImageTextRecognition, NSObject)

RCT_EXTERN_METHOD(recognizeBase64:(NSString *)content
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(recognizeUri:(NSString *)uri
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
