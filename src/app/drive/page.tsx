import { NavBar } from "@/components/ui/NavBar";
import { RouteDriveFlow } from "@/components/drive/RouteDriveFlow";

export default function DrivePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <NavBar />
      <RouteDriveFlow />
    </div>
  );
}
