import { NotificationBell } from "../notifications/NotificationBell";

export function TopBar() {
  return (
    <div className="pointer-events-none absolute right-5 top-4 z-30">
      <div className="pointer-events-auto">
        <NotificationBell />
      </div>
    </div>
  );
}
