import { createSpeechSettingsReturnCoordinator } from '../speech/settingsReturnRecheck';

describe('speech Settings return coordinator', () => {
  it('requires a real leave-and-return transition and runs only once', () => {
    const onReturn = jest.fn();
    const coordinator = createSpeechSettingsReturnCoordinator(onReturn);

    coordinator.markOpeningSettings();
    coordinator.handleAppState('active');
    expect(onReturn).not.toHaveBeenCalled();

    coordinator.handleAppState('inactive');
    coordinator.handleAppState('active');
    coordinator.handleAppState('active');
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('does not recheck after opening Settings fails or the hook is disposed', () => {
    const onReturn = jest.fn();
    const coordinator = createSpeechSettingsReturnCoordinator(onReturn);

    coordinator.markOpeningSettings();
    coordinator.markOpenFailed();
    coordinator.handleAppState('background');
    coordinator.handleAppState('active');

    coordinator.markOpeningSettings();
    coordinator.handleAppState('background');
    coordinator.dispose();
    coordinator.handleAppState('active');
    expect(onReturn).not.toHaveBeenCalled();
  });
});
