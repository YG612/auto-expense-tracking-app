import { useEffect } from 'react';
import { AppState } from 'react-native';

import { importPendingAgentCommandsAutomatically } from '../importers/agentCommandAutoImport';
import { useRepositories } from './DatabaseProvider';

export function AgentCommandAutoImporter() {
  const repositories = useRepositories();

  useEffect(() => {
    const importPending = () => {
      importPendingAgentCommandsAutomatically(repositories).catch(
        () => undefined,
      );
    };
    importPending();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') importPending();
    });
    return () => subscription.remove();
  }, [repositories]);

  return null;
}
