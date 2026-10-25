import type { Metadata } from "next";
import "../../../components/copilote/copilote.css";
import { Copilote } from "../../../components/copilote/Copilote";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { lireMissionContexte, suggestionsPour } from "../../../lib/copilote";
import { exigerPermission } from "../../../lib/session";

export const metadata: Metadata = { title: "Copilote" };

/**
 * Copilote conversationnel (AGT-08) : une seule interface pour interroger CabinetPilot en français,
 * dans les droits de l'utilisateur. Les réponses sont construites par le serveur à partir des
 * données visibles de l'utilisateur ; toute action modifiante est proposée puis confirmée sur une
 * carte. Le droit `copilote.utiliser` est exigé ici (confort d'affichage) et par l'API (source de
 * vérité). Le composant client ne reçoit que des propriétés sérialisables.
 */
export default async function PageCopilote({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("copilote.utiliser");
  const missionId = lireMissionContexte(await searchParams);
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre="Copilote"
        soustitre="Posez vos questions en français : le copilote répond dans vos droits et propose, sans jamais les effectuer seul, les actions que vous confirmez."
      />
      <Carte>
        <Copilote
          suggestions={suggestionsPour(utilisateur.roles)}
          missionId={missionId}
          portee={utilisateur.id}
        />
      </Carte>
    </div>
  );
}
