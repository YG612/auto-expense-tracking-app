cmake_minimum_required(VERSION 3.22.1)
project(qingji_bill_classifier LANGUAGES CXX)

set(PROJECT_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")
set(FASTTEXT_ROOT "${PROJECT_ROOT}/third_party/fasttext/src")
set(CLASSIFIER_ROOT "${PROJECT_ROOT}/native/bill-classifier")

add_library(
  qingji_bill_classifier
  SHARED
  src/main/cpp/bill_classifier_jni.cpp
  ${CLASSIFIER_ROOT}/OnDeviceBillClassifierCore.cc
  ${FASTTEXT_ROOT}/args.cc
  ${FASTTEXT_ROOT}/matrix.cc
  ${FASTTEXT_ROOT}/dictionary.cc
  ${FASTTEXT_ROOT}/loss.cc
  ${FASTTEXT_ROOT}/productquantizer.cc
  ${FASTTEXT_ROOT}/densematrix.cc
  ${FASTTEXT_ROOT}/quantmatrix.cc
  ${FASTTEXT_ROOT}/vector.cc
  ${FASTTEXT_ROOT}/model.cc
  ${FASTTEXT_ROOT}/utils.cc
  ${FASTTEXT_ROOT}/meter.cc
  ${FASTTEXT_ROOT}/fasttext.cc
)

target_include_directories(
  qingji_bill_classifier
  PRIVATE
  ${FASTTEXT_ROOT}
  ${CLASSIFIER_ROOT}
)
target_compile_features(qingji_bill_classifier PRIVATE cxx_std_17)
target_compile_options(qingji_bill_classifier PRIVATE -O3 -fvisibility=hidden)
find_library(log-lib log)
target_link_libraries(qingji_bill_classifier ${log-lib})
