import type { Metadata } from "next";
import "../../../components/copilote/copilote.css";
import { Copilote } from "../../../components/copilote/Copilote";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { lireMissionContexte, suggestionsPour } from "../../../lib/copilote";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { exigerPermission } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Copilote", "Copilot") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const missionId = lireMissionContexte(await searchParams);
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={t("Copilote", "Copilot")}
        soustitre={t(
          "Posez vos questions en français : le copilote répond dans vos droits et propose, sans jamais les effectuer seul, les actions que vous confirmez.",
          "Ask your questions in plain language: the copilot answers within your permissions and proposes, without ever carrying them out alone, the actions you confirm.",
        )}
      />
      <Carte>
        <Copilote
          suggestions={suggestionsPour(utilisateur.roles, langue)}
          missionId={missionId}
          portee={utilisateur.id}
        />
      </Carte>
    </div>
  );
}
