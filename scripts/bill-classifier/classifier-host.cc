#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <string>

#include "OnDeviceBillClassifierCore.h"

int main(int argc, char** argv) {
  if (argc != 6) return 2;
  const std::string text((std::istreambuf_iterator<char>(std::cin)),
                         std::istreambuf_iterator<char>());
  if (text.empty() || text.size() > 2000) return 3;
  try {
    qingji::classification::OnDeviceBillClassifierCore classifier(
        argv[1], std::strtof(argv[3], nullptr), std::strtof(argv[4], nullptr),
        std::strtof(argv[5], nullptr));
    const auto result = classifier.classify(text, argv[2]);
    std::cout << result.parentCategoryKey << '\t' << result.subcategoryKey
              << '\t' << std::setprecision(9) << result.top1Probability << '\t'
              << result.top2Probability << '\t' << result.calibratedConfidence
              << '\t' << result.calibratedTop2Probability << '\t'
              << (result.abstained ? "1" : "0") << '\t' << result.reason
              << '\t' << result.latencyMs << '\n';
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 4;
  }
}
