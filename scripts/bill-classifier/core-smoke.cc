#include <iostream>
#include <string>

#include "OnDeviceBillClassifierCore.h"

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  qingji::classification::OnDeviceBillClassifierCore classifier(argv[1]);
  const auto taxi = classifier.classify("打车 <AMOUNT>", "EXPENSE");
  const auto salary = classifier.classify("工资到账 <AMOUNT>", "INCOME");
  const auto unknown = classifier.classify("完全未知的描述", "EXPENSE");
  const auto counterparty = classifier.scoreCounterpartyCandidate(
      "在青禾餐厅吃饭68元 候选开始 青禾餐厅 候选结束 候选文本 "
      "青禾餐厅 候选来源 VENUE 候选长度 中 交易线索 有 否定交易 无 "
      "行程语境 无 地点修饰 无");
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
  if (counterparty.primaryProbability < 0.05F) {
    std::cerr << "Counterparty candidate scoring failed.\n";
    return 6;
  }
  std::cout << "Native core smoke PASS: taxi=" << taxi.parentCategoryKey << "/"
            << taxi.subcategoryKey << ", salary=" << salary.parentCategoryKey
            << ", unknown=ABSTAINED, counterparty="
            << counterparty.primaryProbability << "\n";
  return 0;
}
