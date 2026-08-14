#include <iostream>
#include <string>

#include "OnDeviceBillClassifierCore.h"

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  qingji::classification::OnDeviceBillClassifierCore classifier(argv[1]);
  const auto taxi = classifier.classify("打车 <AMOUNT>", "EXPENSE");
  const auto salary = classifier.classify("工资到账 <AMOUNT>", "INCOME");
  const auto unknown = classifier.classify("完全未知的描述", "EXPENSE");
  if (taxi.abstained || taxi.parentCategoryKey != "expense.transport" ||
      taxi.subcategoryKey != "expense.transport.taxi") {
    std::cerr << "Taxi smoke prediction failed.\n";
    return 3;
  }
  if (salary.abstained || salary.parentCategoryKey != "income.salary") {
    std::cerr << "Salary smoke prediction failed.\n";
    return 4;
  }
  if (!unknown.abstained) {
    std::cerr << "Unknown-text abstention failed.\n";
    return 5;
  }
  std::cout << "Native core smoke PASS: taxi=" << taxi.parentCategoryKey << "/"
            << taxi.subcategoryKey << ", salary=" << salary.parentCategoryKey
            << ", unknown=ABSTAINED\n";
  return 0;
}
