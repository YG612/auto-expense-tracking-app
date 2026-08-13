import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = { children: ReactNode };
type State = { failed: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Deliberately do not log the raw exception. A future consented diagnostic
    // pipeline must redact ledger text and platform paths before persistence.
  }

  private reset = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <View style={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>
          页面暂时无法显示
        </Text>
        <Text style={styles.message}>
          账本数据没有被删除。请重试；如果问题持续，请重新打开
          App。（错误码：UI-BOUNDARY-UNEXPECTED）
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={this.reset}
          style={styles.button}
        >
          <Text style={styles.buttonText}>重试</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    padding: 24,
  },
  title: { color: '#0F172A', fontSize: 22, fontWeight: '800' },
  message: { color: '#475569', fontSize: 14, lineHeight: 22 },
  button: {
    minHeight: 48,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#2563EB',
    paddingHorizontal: 20,
  },
  buttonText: { color: '#FFFFFF', fontWeight: '800' },
});
