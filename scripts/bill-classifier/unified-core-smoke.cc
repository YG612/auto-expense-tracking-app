#include <iostream>
#include <string>

#include "OnDeviceBillClassifierCore.h"

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  qingji::classification::OnDeviceBillClassifierCore classifier(
      argv[1], 0.2F, 0.01F, 1.0F);
  const auto food = classifier.classify("盖饭午餐", "EXPENSE");
  const auto income = classifier.classify("工资到账", "INCOME");
  const auto mismatch = classifier.classify("工资到账", "EXPENSE");
  if (food.abstained || food.parentCategoryKey != "expense.food" ||
      !food.subcategoryKey.empty()) {
    std::cerr << "Unified expense smoke prediction failed.\n";
    return 3;
  }
  if (income.abstained || income.parentCategoryKey != "income" ||
      !income.subcategoryKey.empty()) {
    std::cerr << "Unified income smoke prediction failed.\n";
    return 4;
  }
  if (!mismatch.abstained || mismatch.reason != "TYPE_MISMATCH") {
    std::cerr << "Unified direction mismatch was not rejected.\n";
    return 5;
  }
  std::cout << "Unified native core smoke PASS: food="
            << food.parentCategoryKey << ", income=" << income.parentCategoryKey
            << ", mismatch=ABSTAINED\n";
  return 0;
}
