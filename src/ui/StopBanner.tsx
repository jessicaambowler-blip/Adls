import { useActivity } from '../activities/useActivity';
import { useStore } from '../model/store';
import type { LayoutKey } from '../model/types';

/** Over a plan or 3D view: says plainly when the wheelchair can't get past a wall. */
export const StopBanner = ({ layoutKey }: { layoutKey: LayoutKey }) => {
  const built = useActivity(layoutKey);
  const reached = useStore((s) => !!built.stopped && s.time >= built.stopped.t - 0.2);
  if (!built.stopped || !reached) return null;
  return (
    <div className="stop-banner" role="status">
      <b>⛔ Can’t get through here.</b> The wheelchair can’t get past {built.stopped.where}.
    </div>
  );
};
