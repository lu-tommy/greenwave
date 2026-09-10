import { NavBar } from "@/components/ui/NavBar";
import { DriveView } from "@/components/drive/DriveView";

/**
 * Secondary drive mode: manual corridor selection (the original V1 flow),
 * preserved for the demo corridor and for testing without a routing
 * provider configured. The primary flow is now destination-based — see
 * /drive.
 */
export default function CorridorDrivePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <NavBar />
      <DriveView />
    </div>
  );
}
