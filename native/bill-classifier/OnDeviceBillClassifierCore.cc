#include "OnDeviceBillClassifierCore.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <sstream>
#include <stdexcept>
#include <utility>
#include <vector>

#include "fasttext.h"

namespace qingji::classification {
namespace {

constexpr float kParentConfidence = 0.82F;
constexpr float kParentMargin = 0.18F;
constexpr float kChildConfidence = 0.78F;
constexpr float kChildMargin = 0.15F;
constexpr const char* kLabelPrefix = "__label__";

std::string stripLabelPrefix(const std::string& label) {
  const std::string prefix(kLabelPrefix);
  return label.rfind(prefix, 0) == 0 ? label.substr(prefix.size()) : label;
}

std::vector<std::pair<float, std::string>> predict(
    fasttext::FastText& model,
    const std::string& text) {
  std::istringstream input(text + "\n");
  std::vector<std::pair<fasttext::real, std::string>> raw;
  if (!model.predictLine(input, raw, 2, 0.0F) || raw.empty()) {
    return {};
  }
  std::vector<std::pair<float, std::string>> result;
  result.reserve(raw.size());
  for (const auto& item : raw) {
    result.emplace_back(item.first, stripLabelPrefix(item.second));
  }
  return result;
}

bool accepted(const std::vector<std::pair<float, std::string>>& predictions,
              float confidence,
              float margin) {
  const auto first = predictions.empty() ? 0.0F : predictions[0].first;
  const auto second = predictions.size() < 2 ? 0.0F : predictions[1].first;
  return first >= confidence && first - second >= margin;
}

}  // namespace

std::unique_ptr<fasttext::FastText> OnDeviceBillClassifierCore::loadModel(
    const std::string& path) {
  auto model = std::make_unique<fasttext::FastText>();
  model->loadModel(path);
  return model;
}

OnDeviceBillClassifierCore::OnDeviceBillClassifierCore(
    std::string modelDirectory)
    : modelDirectory_(std::move(modelDirectory)),
      expenseParent_(loadModel(modelDirectory_ + "/parent-expense.ftz")),
      incomeParent_(loadModel(modelDirectory_ + "/parent-income.ftz")) {}

OnDeviceBillClassifierCore::~OnDeviceBillClassifierCore() = default;

ClassificationResult OnDeviceBillClassifierCore::classify(
    const std::string& text,
    const std::string& transactionType) const {
  const auto started = std::chrono::steady_clock::now();
  ClassificationResult result;
  if (text.empty() || text.size() > 2000) {
    result.reason = "OOV";
    return result;
  }

  fasttext::FastText* parent = nullptr;
  if (transactionType == "EXPENSE") {
    parent = expenseParent_.get();
  } else if (transactionType == "INCOME") {
    parent = incomeParent_.get();
  } else {
    result.reason = "TYPE_UNSUPPORTED";
    return result;
  }

  const auto parentPredictions = predict(*parent, text);
  result.top1Probability =
      parentPredictions.empty() ? 0.0F : parentPredictions[0].first;
  result.top2Probability =
      parentPredictions.size() < 2 ? 0.0F : parentPredictions[1].first;
  result.calibratedConfidence = result.top1Probability;
  if (!accepted(parentPredictions, kParentConfidence, kParentMargin)) {
    result.reason = result.top1Probability < kParentConfidence
                        ? "LOW_CONFIDENCE"
                        : "LOW_MARGIN";
  } else {
    result.parentCategoryKey = parentPredictions[0].second;
    result.abstained = false;
    if (transactionType == "EXPENSE") {
      try {
        auto child = loadModel(modelDirectory_ + "/child-" +
                               result.parentCategoryKey + ".ftz");
        const auto childPredictions = predict(*child, text);
        if (accepted(childPredictions, kChildConfidence, kChildMargin)) {
          result.subcategoryKey = childPredictions[0].second;
        }
      } catch (const std::exception&) {
        // A valid parent prediction remains useful if an optional child head
        // is absent or unreadable.
      }
    }
  }

  result.latencyMs = std::chrono::duration<double, std::milli>(
                         std::chrono::steady_clock::now() - started)
                         .count();
  return result;
}

}  // namespace qingji::classification
