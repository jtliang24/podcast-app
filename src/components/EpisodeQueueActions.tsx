import { ChevronUp, ListEnd, ListPlus } from 'lucide-react';
import type { QueueAction } from '../types';

const actions = [
  { action: 'play-next', label: 'Play Next', Icon: ChevronUp },
  { action: 'play-up-next', label: 'Play up next', Icon: ListEnd },
  { action: 'add-to-queue', label: 'Add to Queue', Icon: ListPlus },
] as const;

export default function EpisodeQueueActions({ onAction, className }: {
  onAction: (action: QueueAction) => void;
  className: string;
}) {
  return actions.map(({ action, label, Icon }) => (
    <button key={action} type="button" onClick={() => onAction(action)} className={className}>
      <Icon size={16} className="mr-2 shrink-0" aria-hidden="true" />
      {label}
    </button>
  ));
}
