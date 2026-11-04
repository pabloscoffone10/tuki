import { Suspense } from "react";
import { GroupsList } from "@/features/groups/components/groups-list";
import Loading from "@/app/loading";
export const metadata = { title: "Mis grupos" };
export default async function GroupsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams;
  return <Suspense fallback={<Loading />}><GroupsList cleanupId={typeof params.limpieza==="string"?params.limpieza:undefined} deleted={params.eliminado==="1"} /></Suspense>;
}
