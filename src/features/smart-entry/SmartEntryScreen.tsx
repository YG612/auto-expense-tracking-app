import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons/static';
import {
  type StaticScreenProps,
  useFocusEffect,
  useNavigation,
} from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRepositories } from '../../app/DatabaseProvider';
import { parseTextTransactions } from '../../classification/parseTextTransactions';
import {
  enrichCandidatesWithOnDeviceModel,
  onDeviceBillClassifier,
} from '../../classification/model';
import type { ParsedTransactionCandidate } from '../../classification/types';
import { safeErrorMessage } from '../../domain/errors/AppError';
import type {
  Account,
  Category,
  Merchant,
  UserRule,
} from '../../domain/entities';
import type { TextTransactionReferenceData } from '../../domain/services/textTransaction';
import {
  type ManualTransactionDraft,
  validateManualTransaction,
} from '../../domain/services/manualTransaction';
import { simplifyBookkeepingClassification } from '../../domain/policies/simplifiedBookkeepingPolicy';
import type { RecognizedConfirmationIntent } from '../../domain/services/reviewDisposition';
import { recognizeImageUri } from '../../native/ImageTextRecognition';
import { consumeSharedEntryPayload } from '../../native/SharedEntryPayload';
import {
  type SpeechRecognitionActions,
  useSpeechRecognition,
} from '../../speech/useSpeechRecognition';
import {
  colors,
  control,
  radius,
  shadows,
  spacing,
  typography,
} from '../../theme/tokens';
import {
  bookkeepingSession,
  type SessionCandidate,
  useBookkeepingSession,
} from './BookkeepingSession';
import {
  persistEditedSessionCandidate,
  persistRecognizedSessionCandidate,
  prepareSessionCandidateForEditing,
} from './BookkeepingSessionPersistence';
import { ConfirmationCard } from './components/ConfirmationCard';
import { VoiceEntryPanel } from './components/VoiceEntryPanel';

type LoadedReferences = TextTransactionReferenceData & {
  userRules: readonly UserRule[];
  merchants: readonly Merchant[];
};

function categoryLabel(
  candidate: ParsedTransactionCandidate,
  categories: readonly Category[],
): string {
  const simplified = simplifyBookkeepingClassification({
    type: candidate.type,
    categoryKey: candidate.categoryKey,
    storedValueRecharge:
      candidate.semanticFlags?.possibleStoredValueRecharge === true,
  });
  const label = candidate.classificationLabel ?? simplified.classificationLabel;
  if (label === 'income') {
    return '收入';
  }
  const category = categories.find(item => item.systemKey === label);
  if (category === undefined) {
    return '待确认';
  }
  return category.name;
}

function accountLabel(
  candidateKey: ParsedTransactionCandidate['accountKey'],
  hint: string | undefined,
  accounts: readonly Account[],
): string {
  return (
    accounts.find(account => account.id === hint)?.name ??
    accounts.find(account => account.type === candidateKey)?.name ??
    '待补充'
  );
}

export type SmartEntryScreenParams =
  | { text?: string; token?: string; imageUri?: string; source?: string }
  | undefined;

export function SmartEntryScreen({
  initialText,
  initialShareToken,
  initialImageUri,
  initialTextSource,
}: {
  initialText?: string;
  initialShareToken?: string;
  initialImageUri?: string;
  initialTextSource?: string;
} = {}) {
  const navigation = useNavigation();
  const repositories = useRepositories();
  const session = useBookkeepingSession();
  const [input, setInput] = useState('');
  const [secureSharedText, setSecureSharedText] = useState<string>();
  const [references, setReferences] = useState<LoadedReferences>();
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState<string>();
  const [error, setError] = useState<string>();
  const [ocrBusy, setOcrBusy] = useState(false);
  const [classificationBusy, setClassificationBusy] = useState(false);
  const entryGenerationRef = useRef(session.entryGeneration);
  const speechActionsRef = useRef<SpeechRecognitionActions | undefined>(
    undefined,
  );
  const claimedSpeechResultsRef = useRef(new Set<string>());
  const classificationRequestsRef = useRef(new Set<string>());
  const handledCompletionIdRef = useRef<string | undefined>(undefined);
  const handledImageUriRef = useRef<string | undefined>(undefined);
  entryGenerationRef.current = session.entryGeneration;

  useEffect(() => {
    const token = initialShareToken?.trim();
    if (token === undefined || token.length === 0) return;
    consumeSharedEntryPayload(token)
      .then(text => {
        if (text === undefined) {
          throw new Error('分享内容已过期或已被使用，请重新分享。');
        }
        setSecureSharedText(text);
      })
      .catch(caught => {
        setError(
          safeErrorMessage(
            caught,
            '无法安全读取分享内容，请重新分享。',
            'SMART-ENTRY-SHARED-PAYLOAD-UNEXPECTED',
          ),
        );
      });
  }, [initialShareToken]);

  useEffect(() => {
    const sharedText = (initialText ?? secureSharedText)?.trim();
    if (sharedText === undefined || sharedText.length === 0) return;
    if (initialTextSource !== 'ocr') {
      setInput(sharedText.slice(0, 2_000));
      return;
    }
    repositories.experimentalFeatures
      .get()
      .then(settings => {
        if (!settings.imageOcrEnabled) {
          throw new Error('请先在设置中开启截图文字识别实验功能。');
        }
        setInput(sharedText.slice(0, 2_000));
      })
      .catch(caught => {
        setError(
          safeErrorMessage(
            caught,
            '无法读取分享的识别结果，请手动输入。',
            'SMART-OCR-TEXT-UNEXPECTED',
          ),
        );
      });
  }, [initialText, initialTextSource, repositories, secureSharedText]);

  useEffect(() => {
    const uri = initialImageUri?.trim();
    if (
      uri === undefined ||
      uri.length === 0 ||
      handledImageUriRef.current === uri
    ) {
      return;
    }
    handledImageUriRef.current = uri;
    setOcrBusy(true);
    setError(undefined);
    repositories.experimentalFeatures
      .get()
      .then(settings => {
        if (!settings.imageOcrEnabled) {
          throw new Error('请先在设置中开启截图文字识别实验功能。');
        }
        return recognizeImageUri(uri);
      })
      .then(result => {
        const normalized = result.text.trim();
        if (normalized.length === 0) throw new Error('截图中没有识别到文字。');
        setInput(normalized.slice(0, 2_000));
      })
      .catch(caught => {
        setError(
          safeErrorMessage(
            caught,
            '无法识别分享的图片，请手动输入。',
            'SMART-OCR-SHARE-UNEXPECTED',
          ),
        );
      })
      .finally(() => setOcrBusy(false));
  }, [initialImageUri, repositories]);

  const advanceEntryBarrier = useCallback(() => {
    const nextGeneration = bookkeepingSession.advanceEntryGeneration();
    entryGenerationRef.current = nextGeneration;
    speechActionsRef.current?.resetForNewDraft();
    return nextGeneration;
  }, []);

  // Keep this lifecycle barrier independent from reference loading. The load
  // effect can restart while focused; this cleanup must run only on blur.
  useFocusEffect(
    useCallback(
      () => () => {
        advanceEntryBarrier();
      },
      [advanceEntryBarrier],
    ),
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setLoadError(undefined);
      if (loadAttempt > 0) {
        setReferences(undefined);
      }
      Promise.all([
        repositories.categories.listVisible(),
        repositories.accounts.listVisibleByUsage(),
        repositories.projects.listActive(),
        repositories.tags.listAll(),
        repositories.userRules.listEnabled(),
        repositories.merchants.listAll(),
      ])
        .then(
          ([categories, accounts, projects, tags, userRules, merchants]) => {
            if (active) {
              setReferences({
                categories,
                accounts,
                projects,
                tags,
                userRules,
                merchants,
              });
              setError(undefined);
              setLoadError(undefined);
            }
          },
        )
        .catch(loadFailure => {
          if (active) {
            setReferences(undefined);
            setLoadError(
              safeErrorMessage(
                loadFailure,
                '读取本地识别资料失败。',
                'SMART-LOAD-UNEXPECTED',
              ),
            );
          }
        })
        .finally(() => {
          if (active) {
            setLoading(false);
          }
        });
      return () => {
        active = false;
      };
    }, [loadAttempt, repositories]),
  );

  const parseDescription = useCallback(
    (
      description: string,
      inputSource: 'TEXT' | 'VOICE',
      expectedGeneration: number,
      resultToken?: string,
    ): Promise<boolean> => {
      if (!bookkeepingSession.isEntryGenerationCurrent(expectedGeneration)) {
        return Promise.resolve(false);
      }
      const trimmed = description.trim();
      if (trimmed.length === 0) {
        setError(
          inputSource === 'VOICE'
            ? '语音转写为空，请重试或改用文字记账。'
            : '请先输入一段记账描述。',
        );
        return Promise.resolve(false);
      }
      if (references === undefined) {
        setError('本地记账资料尚未就绪，请稍后再试。');
        return Promise.resolve(false);
      }
      if (inputSource === 'VOICE' && resultToken === undefined) {
        return Promise.resolve(false);
      }
      if (
        inputSource === 'VOICE' &&
        resultToken !== undefined &&
        claimedSpeechResultsRef.current.has(resultToken)
      ) {
        return Promise.resolve(false);
      }
      const requestKey = `${expectedGeneration}:${inputSource}:${resultToken ?? trimmed}`;
      if (classificationRequestsRef.current.has(requestKey)) {
        return Promise.resolve(false);
      }
      classificationRequestsRef.current.add(requestKey);
      const run = async (): Promise<boolean> => {
        try {
          const result = parseTextTransactions(trimmed, {
            referenceDate: new Date(),
            recentAccountKey: references.accounts[0]?.type,
            categories: references.categories,
            accounts: references.accounts,
            userRules: references.userRules,
            merchants: references.merchants,
          });
          if (result.candidates.length === 0) {
            bookkeepingSession.clearReview();
            setError('没有识别到交易，请补充金额或改用手动填写。');
            return false;
          }
          const candidates = await enrichCandidatesWithOnDeviceModel(
            result.candidates,
            onDeviceBillClassifier,
          );
          if (
            !bookkeepingSession.isEntryGenerationCurrent(expectedGeneration)
          ) {
            return false;
          }
          const startedSessionId = bookkeepingSession.start(
            candidates,
            inputSource,
            trimmed,
            expectedGeneration,
            resultToken,
          );
          if (
            inputSource === 'VOICE' &&
            (resultToken === undefined ||
              speechActionsRef.current?.consumeResult(resultToken) !== true)
          ) {
            if (resultToken !== undefined) {
              claimedSpeechResultsRef.current.add(resultToken);
            }
            bookkeepingSession.discardReviewIfOwned(
              startedSessionId,
              expectedGeneration,
            );
            return false;
          }
          if (resultToken !== undefined) {
            claimedSpeechResultsRef.current.add(resultToken);
          }
          if (
            !bookkeepingSession.isEntryGenerationCurrent(expectedGeneration)
          ) {
            bookkeepingSession.discardReviewIfOwned(
              startedSessionId,
              expectedGeneration,
            );
            return false;
          }
          if (inputSource === 'VOICE') {
            setInput(trimmed);
          }
          setError(undefined);
          return true;
        } catch (parseError) {
          if (
            !bookkeepingSession.isEntryGenerationCurrent(expectedGeneration)
          ) {
            return false;
          }
          setError(
            safeErrorMessage(
              parseError,
              '记账描述解析失败。',
              'SMART-PARSE-UNEXPECTED',
            ),
          );
          return false;
        }
      };
      setClassificationBusy(true);
      return run().finally(() => {
        classificationRequestsRef.current.delete(requestKey);
        setClassificationBusy(classificationRequestsRef.current.size > 0);
      });
    },
    [references],
  );

  const [speechSnapshot, speechActions] = useSpeechRecognition(
    (transcript, resultToken) => {
      parseDescription(
        transcript,
        'VOICE',
        entryGenerationRef.current,
        resultToken,
      );
    },
  );
  speechActionsRef.current = speechActions;

  useEffect(() => {
    const completion = session.completion;
    if (
      completion === undefined ||
      handledCompletionIdRef.current === completion.id
    ) {
      return;
    }
    handledCompletionIdRef.current = completion.id;
    advanceEntryBarrier();
    setInput('');
  }, [advanceEntryBarrier, session.completion]);

  const parse = () =>
    parseDescription(input, 'TEXT', entryGenerationRef.current);

  const persist = async (
    item: SessionCandidate,
    status: 'CONFIRMED' | 'PENDING',
    confirmationIntent?: RecognizedConfirmationIntent,
  ) => {
    if (references === undefined) {
      return;
    }
    const actionGeneration = entryGenerationRef.current;
    setError(undefined);
    const result = await bookkeepingSession.persistCandidate(
      item.sessionId,
      item.id,
      status,
      candidate =>
        persistRecognizedSessionCandidate(
          candidate,
          status,
          references,
          repositories,
          confirmationIntent === undefined ? {} : { confirmationIntent },
        ).then(persistenceResult => {
          if (
            persistenceResult.outcome === 'COMMITTED' &&
            status === 'CONFIRMED' &&
            item.candidate.matchedRuleId !== undefined &&
            bookkeepingSession.isEntryGenerationCurrent(actionGeneration)
          ) {
            repositories.userRules
              .recordUsage(
                item.candidate.matchedRuleId,
                new Date().toISOString(),
              )
              .catch(() => {
                if (
                  bookkeepingSession.isEntryGenerationCurrent(actionGeneration)
                ) {
                  setError('交易已确认，但规则使用统计暂时未能更新。');
                }
              });
          }
          return persistenceResult.outcome;
        }),
    );
    if (!bookkeepingSession.isEntryGenerationCurrent(actionGeneration)) {
      return result;
    }

    const completion = bookkeepingSession.getSnapshot().completion;
    if (
      result.status === 'SAVED' &&
      completion !== undefined &&
      handledCompletionIdRef.current !== completion.id
    ) {
      handledCompletionIdRef.current = completion.id;
      advanceEntryBarrier();
      setInput('');
    }
    return result;
  };

  const persistInlineEdit = async (
    item: SessionCandidate,
    draft: ManualTransactionDraft,
  ) => {
    if (references === undefined) return;
    const validation = validateManualTransaction(draft);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    const current = bookkeepingSession.getCandidate(item.sessionId, item.id);
    if (current?.reviewState === 'READY') {
      if (!bookkeepingSession.beginEdit(item.sessionId, item.id)) return;
    } else if (current?.reviewState !== 'EDITING') {
      return;
    }

    const actionGeneration = entryGenerationRef.current;
    setError(undefined);
    const result = await bookkeepingSession.persistEditedCandidate(
      item.sessionId,
      item.id,
      candidate =>
        persistEditedSessionCandidate(
          candidate,
          draft,
          validation.amountMinor,
          references,
          repositories,
        ).then(persistenceResult => {
          if (
            !persistenceResult.wasAlreadySaved &&
            item.candidate.matchedRuleId !== undefined &&
            bookkeepingSession.isEntryGenerationCurrent(actionGeneration)
          ) {
            repositories.userRules
              .recordUsage(
                item.candidate.matchedRuleId,
                new Date().toISOString(),
              )
              .catch(() => {
                if (
                  bookkeepingSession.isEntryGenerationCurrent(actionGeneration)
                ) {
                  setError('交易已确认，但规则使用统计暂时未能更新。');
                }
              });
          }
          return persistenceResult.wasAlreadySaved
            ? 'ALREADY_COMMITTED'
            : 'COMMITTED';
        }),
    );
    if (!bookkeepingSession.isEntryGenerationCurrent(actionGeneration)) {
      return result;
    }
    const completion = bookkeepingSession.getSnapshot().completion;
    if (
      result.status === 'SAVED' &&
      completion !== undefined &&
      handledCompletionIdRef.current !== completion.id
    ) {
      handledCompletionIdRef.current = completion.id;
      advanceEntryBarrier();
      setInput('');
    }
    return result;
  };

  const speechActive = !['IDLE', 'SUCCEEDED', 'CANCELLED', 'ERROR'].includes(
    speechSnapshot.status,
  );
  const canParse =
    input.trim().length > 0 &&
    references !== undefined &&
    !speechActive &&
    !classificationBusy;
  const reviewing = session.candidates.length > 0;
  const reviewSaving = session.candidates.some(
    item => item.reviewState === 'SAVING',
  );
  const visibleError = error ?? session.error;

  const discardCurrentReview = () => {
    advanceEntryBarrier();
    try {
      bookkeepingSession.discardReview();
      setInput('');
      setError(undefined);
    } catch (discardError) {
      setError(
        safeErrorMessage(
          discardError,
          '当前结果仍在保存，请稍后再重新输入。',
          'SMART-DISCARD-UNEXPECTED',
        ),
      );
    }
  };

  const startAnotherEntry = () => {
    const completionId = session.completion?.id;
    if (completionId === undefined) {
      return;
    }
    advanceEntryBarrier();
    bookkeepingSession.dismissCompletion(completionId);
    setInput('');
    setError(undefined);
  };

  if (loading) {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.centered}>
        <ActivityIndicator color={colors.brand} size="large" />
        <Text style={styles.muted}>正在准备记账…</Text>
      </SafeAreaView>
    );
  }

  if (loadError !== undefined || references === undefined) {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.centered}>
        <View style={styles.pageError}>
          <MaterialDesignIcons
            color={colors.expenseText}
            name="alert-circle-outline"
            size={25}
          />
          <Text accessibilityRole="alert" style={styles.pageErrorText}>
            {loadError ?? '本地记账资料暂时不可用。'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setLoadAttempt(value => value + 1)}
          style={styles.reloadButton}
        >
          <Text style={styles.reloadButtonText}>重新加载</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {visibleError === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            {visibleError}
          </Text>
        )}

        {session.completion !== undefined ? (
          <View accessibilityLiveRegion="polite" style={styles.completionCard}>
            <View style={styles.completionIcon}>
              <MaterialDesignIcons
                color={colors.incomeText}
                name={
                  session.completion.confirmedCount > 0
                    ? 'check-circle-outline'
                    : 'inbox-arrow-down-outline'
                }
                size={34}
              />
            </View>
            <Text accessibilityRole="alert" style={styles.completionTitle}>
              {session.completion.message}
            </Text>
            <Text style={styles.completionHint}>
              {session.completion.confirmedCount > 0
                ? '已写入本地账本，可以继续记录下一笔。'
                : '已保存到待处理，之后可以继续核对。'}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={startAnotherEntry}
              style={styles.parseButton}
            >
              <Text style={styles.parseButtonText}>再记一笔</Text>
            </Pressable>
          </View>
        ) : reviewing ? (
          <>
            <View style={styles.reviewHeader}>
              <Text accessibilityRole="header" style={styles.resultTitle}>
                确认账单
              </Text>
              <Text style={styles.resultCount}>
                {session.candidates.length} 笔
              </Text>
            </View>
            <Text style={styles.reviewHint}>核对关键信息后再入账</Text>
            {session.candidates.map((item, index) => (
              <ConfirmationCard
                accountLabel={accountLabel(
                  item.candidate.accountKey,
                  item.candidate.accountIdHint,
                  references.accounts,
                )}
                candidate={item.candidate}
                categoryLabel={categoryLabel(
                  item.candidate,
                  references.categories,
                )}
                index={index}
                initialDraft={
                  prepareSessionCandidateForEditing(
                    item,
                    references,
                    new Date(item.createdAt),
                  ).draft
                }
                key={item.id}
                onConfirmEdited={draft => persistInlineEdit(item, draft)}
                onEdit={() => {
                  if (bookkeepingSession.beginEdit(item.sessionId, item.id)) {
                    navigation.navigate('ManualEntry', {
                      sessionId: item.sessionId,
                      candidateId: item.id,
                    });
                  }
                }}
                onPending={() => persist(item, 'PENDING')}
                references={references}
                reviewState={item.reviewState}
                targetAccountLabel={accountLabel(
                  item.candidate.targetAccountKey,
                  undefined,
                  references.accounts,
                )}
              />
            ))}
            <Pressable
              accessibilityHint="未保存的候选将被清除"
              accessibilityLabel="放弃本次结果并重新输入"
              accessibilityRole="button"
              disabled={reviewSaving}
              onPress={discardCurrentReview}
              style={[styles.discardReview, reviewSaving && styles.disabled]}
            >
              <MaterialDesignIcons
                color={colors.inkMuted}
                name="close-circle-outline"
                size={18}
              />
              <Text style={styles.discardReviewText}>
                放弃本次结果并重新输入
              </Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.inputCard}>
            <Text accessibilityRole="header" style={styles.title}>
              记一笔
            </Text>
            <TextInput
              accessibilityLabel="记账描述"
              editable={!speechActive && !ocrBusy && !classificationBusy}
              maxLength={2_000}
              multiline
              onChangeText={setInput}
              placeholder="说一笔或输入，例如：午饭25，微信"
              placeholderTextColor={colors.placeholder}
              style={[styles.input, speechActive && styles.inputDisabled]}
              textAlignVertical="top"
              value={input}
            />
            <VoiceEntryPanel
              actions={speechActions}
              onUsePartial={(text, resultToken) => {
                parseDescription(
                  text,
                  'VOICE',
                  entryGenerationRef.current,
                  resultToken,
                );
              }}
              showActions={!canParse}
              snapshot={speechSnapshot}
            />
            {classificationBusy ? (
              <View
                accessibilityLiveRegion="polite"
                style={styles.buttonContent}
              >
                <ActivityIndicator color={colors.brand} size="small" />
                <Text style={styles.muted}>正在进行端侧分类…</Text>
              </View>
            ) : null}
            {canParse ? (
              <Pressable
                accessibilityHint="不会立即写入账本，下一步仍需核对后确认"
                accessibilityLabel="核对账单"
                accessibilityRole="button"
                onPress={parse}
                style={styles.parseButton}
              >
                <View style={styles.buttonContent}>
                  <MaterialDesignIcons
                    color={colors.white}
                    name="creation-outline"
                    size={19}
                  />
                  <Text style={styles.parseButtonText}>核对账单</Text>
                </View>
              </Pressable>
            ) : null}
            <View style={styles.secondaryLinks}>
              <Pressable
                accessibilityLabel="手动填写"
                accessibilityRole="button"
                onPress={() => navigation.navigate('ManualEntry', undefined)}
                style={styles.secondaryLink}
              >
                <MaterialDesignIcons
                  color={colors.inkSecondary}
                  name="pencil-outline"
                  size={18}
                />
                <Text style={styles.secondaryLinkText}>手动填写</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="待处理"
                accessibilityRole="button"
                onPress={() => navigation.navigate('Pending')}
                style={styles.secondaryLink}
              >
                <MaterialDesignIcons
                  color={colors.inkSecondary}
                  name="inbox-arrow-down-outline"
                  size={18}
                />
                <Text style={styles.secondaryLinkText}>待处理</Text>
              </Pressable>
            </View>
            <Text style={styles.privacy}>
              只有点击“确认入账”才会写入账本；语音仅用于转写，不保存录音。
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export function RoutedSmartEntryScreen({
  route,
}: StaticScreenProps<SmartEntryScreenParams>) {
  return (
    <SmartEntryScreen
      initialImageUri={route.params?.imageUri}
      initialShareToken={route.params?.token}
      initialText={route.params?.text}
      initialTextSource={route.params?.source}
    />
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.canvas,
    padding: spacing.lg,
  },
  content: {
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  inputCard: {
    gap: spacing.sm,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    ...shadows.card,
  },
  title: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  input: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    color: colors.ink,
    fontSize: typography.bodyLarge,
    lineHeight: 24,
    padding: 13,
  },
  inputDisabled: { opacity: 0.7 },
  parseButton: {
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  parseButtonText: {
    color: colors.white,
    fontSize: typography.bodyLarge,
    fontWeight: '800',
    textAlign: 'center',
  },
  secondaryLinks: { flexDirection: 'row', gap: spacing.sm },
  secondaryLink: {
    minHeight: control.minTouchTarget,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
  },
  secondaryLinkText: {
    color: colors.inkSecondary,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  privacy: { color: colors.inkMuted, fontSize: 11, textAlign: 'center' },
  error: {
    borderRadius: radius.md,
    backgroundColor: colors.expenseSoft,
    color: colors.expenseText,
    padding: spacing.sm,
    lineHeight: 19,
  },
  completionCard: {
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    ...shadows.card,
  },
  completionIcon: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
    backgroundColor: colors.incomeSoft,
  },
  completionTitle: {
    color: colors.incomeText,
    fontSize: typography.bodyLarge,
    fontWeight: '900',
    textAlign: 'center',
  },
  completionHint: {
    color: colors.inkMuted,
    fontSize: typography.caption,
    lineHeight: 19,
    textAlign: 'center',
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  resultTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  resultCount: {
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    color: colors.brandPressed,
    fontSize: typography.caption,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  reviewHint: { color: colors.inkMuted, fontSize: typography.caption },
  discardReview: {
    minHeight: control.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  discardReviewText: {
    color: colors.inkMuted,
    fontSize: typography.caption,
    fontWeight: '700',
    textAlign: 'center',
  },
  disabled: { opacity: 0.5 },
  pageError: {
    width: '100%',
    maxWidth: 360,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.expenseSoft,
    padding: spacing.md,
  },
  pageErrorText: {
    minWidth: 0,
    flex: 1,
    color: colors.expenseText,
    fontSize: typography.body,
    lineHeight: 21,
  },
  reloadButton: {
    minHeight: control.minTouchTarget,
    minWidth: 160,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
  },
  reloadButtonText: {
    color: colors.white,
    fontSize: typography.bodyLarge,
    fontWeight: '800',
  },
  muted: { color: colors.inkMuted },
});
