import { Suspense } from "react";
import { GroupsList } from "@/features/groups/components/groups-list";
import Loading from "@/app/loading";
export const metadata = { title: "Mis grupos" };
export default function GroupsPage() {
  return <Suspense fallback={<Loading />}><GroupsList /></Suspense>;
}
