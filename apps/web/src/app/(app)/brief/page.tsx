import type { Metadata } from "next";
import { BriefDuJour } from "../../../components/brief/BriefDuJour";
import { SelecteurDateBrief } from "../../../components/brief/SelecteurDateBrief";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../components/ui/EtatListe";
import { chargerServeur } from "../../../lib/api-serveur";
import {
  hrefBrief,
  lireDateBrief,
  messageBriefIndisponible,
  requeteBrief,
  titreErreurBrief,
  type BriefApi,
} from "../../../lib/brief";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { exigerPermission } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Mon brief", "My brief") };
}

/**
 * « Mon brief » (AUT-07) : ce qui attend la décision de l'utilisateur, ce qui dérive et ce qui est
 * prêt à envoyer. Un calcul du moteur, dans les droits de la personne connectée : aucun texte
 * n'est écrit par une IA et aucun montant n'est servi sans `finance.lire`. La date de référence
 * se choisit dans la page (sélecteur de date) et vit dans l'URL (`?date=AAAA-MM-JJ`) : le rejeu
 * survit au rechargement et se partage par le lien.
 */
export default async function PageBrief({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("brief.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const date = lireDateBrief(await searchParams);
  const r = await chargerServeur<BriefApi>(requeteBrief(date));
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Mon brief", "My brief")}
        soustitre={t(
          "Ce qui attend votre décision, ce qui dérive et ce qui est prêt à partir, d'après vos droits. Les chiffres viennent des moteurs de calcul de la plateforme.",
          "What awaits your decision, what is drifting and what is ready to go, based on your permissions. Figures come from the platform's calculation engines.",
        )}
      />
      <SelecteurDateBrief key={date ?? "jour"} date={date} />
      {r.ok ? (
        <BriefDuJour brief={r.donnees} />
      ) : (
        <EtatErreur
          titre={titreErreurBrief(r.statut, langue)}
          message={messageBriefIndisponible(r.statut, r.message, langue)}
          hrefReessayer={hrefBrief(date)}
        />
      )}
    </div>
  );
}
