#include <chrono>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#endif

#include "OnDeviceBillClassifierCore.h"

namespace {
void sleepMs(int milliseconds) {
#ifdef _WIN32
  Sleep(static_cast<DWORD>(milliseconds));
#else
  usleep(static_cast<useconds_t>(milliseconds) * 1000U);
#endif
}

std::string jsonString(const std::string& value) {
  std::ostringstream output;
  output << '"';
  for (const unsigned char byte : value) {
    if (byte == '"' || byte == '\\') output << '\\' << byte;
    else if (byte == '\n') output << "\\n";
    else if (byte == '\r') output << "\\r";
    else if (byte == '\t') output << "\\t";
    else output << byte;
  }
  output << '"';
  return output.str();
}
}  // namespace

int main(int argc, char** argv) {
  if (argc == 3 && std::string(argv[1]) == "--baseline") {
    sleepMs(std::atoi(argv[2]));
    return 0;
  }
  if (argc != 6) return 2;
  try {
    qingji::classification::OnDeviceBillClassifierCore classifier(
        argv[1], std::strtof(argv[2], nullptr), std::strtof(argv[3], nullptr),
        std::strtof(argv[4], nullptr));
    const int holdMs = std::atoi(argv[5]);
    if (holdMs > 0)
      sleepMs(holdMs);
    std::string line;
    while (std::getline(std::cin, line)) {
      const auto first = line.find('\t');
      const auto second = first == std::string::npos
                              ? std::string::npos
                              : line.find('\t', first + 1);
      if (first == std::string::npos || second == std::string::npos) return 3;
      const auto id = line.substr(0, first);
      const auto direction = line.substr(first + 1, second - first - 1);
      const auto text = line.substr(second + 1);
      const auto result = classifier.classify(text, direction);
      std::cout << "{\"id\":" << jsonString(id)
                << ",\"parentCategoryKey\":"
                << (result.parentCategoryKey.empty()
                        ? "null"
                        : jsonString(result.parentCategoryKey))
                << ",\"abstained\":" << (result.abstained ? "true" : "false")
                << ",\"reason\":"
                << (result.reason.empty() ? "null" : jsonString(result.reason))
                << ",\"latencyMs\":" << std::setprecision(9)
                << result.latencyMs << "}\n";
    }
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 4;
  }
}
