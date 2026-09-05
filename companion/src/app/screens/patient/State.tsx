import { StatePicker, type StateSelection } from './StatePicker';

export function State({
  onLog,
  onBack,
}: {
  onLog: (selection: StateSelection) => void;
  onBack: () => void;
}) {
  return <StatePicker onComplete={onLog} onCancel={onBack} />;
}
