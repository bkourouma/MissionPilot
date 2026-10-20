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
import { exigerPermission } from "../../../lib/session";

export const metadata: Metadata = { title: "Mon brief" };

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
  const date = lireDateBrief(await searchParams);
  const r = await chargerServeur<BriefApi>(requeteBrief(date));
  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Mon brief"
        soustitre="Ce qui attend votre décision, ce qui dérive et ce qui est prêt à partir, d'après vos droits. Les chiffres viennent des moteurs de calcul de la plateforme."
      />
      <SelecteurDateBrief key={date ?? "jour"} date={date} />
      {r.ok ? (
        <BriefDuJour brief={r.donnees} />
      ) : (
        <EtatErreur
          titre={titreErreurBrief(r.statut)}
          message={messageBriefIndisponible(r.statut, r.message)}
          hrefReessayer={hrefBrief(date)}
        />
      )}
    </div>
  );
}
