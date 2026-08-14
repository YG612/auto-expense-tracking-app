#pragma once

#include <memory>
#include <string>

namespace fasttext {
class FastText;
}

namespace qingji::classification {

struct ClassificationResult {
  std::string parentCategoryKey;
  std::string subcategoryKey;
  float top1Probability = 0;
  float top2Probability = 0;
  float calibratedConfidence = 0;
  bool abstained = true;
  std::string reason;
  double latencyMs = 0;
};

class OnDeviceBillClassifierCore {
 public:
  explicit OnDeviceBillClassifierCore(std::string modelDirectory);
  ~OnDeviceBillClassifierCore();

  OnDeviceBillClassifierCore(const OnDeviceBillClassifierCore&) = delete;
  OnDeviceBillClassifierCore& operator=(const OnDeviceBillClassifierCore&) = delete;

  ClassificationResult classify(const std::string& text,
                                const std::string& transactionType) const;

 private:
  std::string modelDirectory_;
  std::unique_ptr<fasttext::FastText> expenseParent_;
  std::unique_ptr<fasttext::FastText> incomeParent_;

  static std::unique_ptr<fasttext::FastText> loadModel(
      const std::string& path);
};

}  // namespace qingji::classification
