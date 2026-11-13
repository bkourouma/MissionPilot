import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContributionAtelier } from "../../../../../components/plan-ateliers/ContributionAtelier";
import "../../../../../components/plan-ateliers/plan-ateliers.css";
import { NonDisponible } from "../../../../../components/portail/NonDisponible";
import { Alerte } from "../../../../../components/ui/Alerte";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import {
  cheminApiAtelierPortail,
  cheminAtelierPortail,
  CHEMIN_ATELIERS_PORTAIL,
  type AtelierPortail,
} from "../../../../../lib/plan-ateliers";
import { estIdentifiant, peut } from "../../../../../lib/portail";
import { chargerPortail, obtenirSessionPortail } from "../../../../../lib/portail-serveur";
import { obtenirT } from "../../../../../lib/i18n/serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Atelier", "Workshop") };
}

/**
 * Un atelier ouvert où vous êtes invité : l'énoncé, les options et le dépôt de VOTRE contribution,
 * que vous pouvez remplacer tant que l'atelier est ouvert. Vous ne voyez jamais les contributions des
 * autres participants ni les résultats.
 */
export default async function DetailAtelierPortail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await obtenirT();
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.ateliers.participer")) {
    return <NonDisponible titre={t("Atelier", "Workshop")} />;
  }
  const r = await chargerPortail<AtelierPortail>(cheminApiAtelierPortail(id));
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: CHEMIN_ATELIERS_PORTAIL, libelle: t("Ateliers", "Workshops") };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Atelier", "Workshop")} retour={retour} />
        <EtatErreur
          titre={t("L'atelier n'a pas pu être chargé.", "The workshop could not be loaded.")}
          message={r.message}
          hrefReessayer={cheminAtelierPortail(id)}
        />
      </div>
    );
  }
  const a = r.donnees;
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage titre={a.titre} retour={retour} />
      <Alerte
        tonalite="info"
        annonce="aucune"
        titre={t("Votre contribution est confidentielle", "Your contribution is confidential")}
      >
        <p>
          {t(
            "Les autres participants ne voient pas vos réponses, et vous ne voyez pas les leurs. Vous pouvez modifier votre contribution tant que l'atelier est ouvert.",
            "Other participants cannot see your answers, and you cannot see theirs. You can change your contribution as long as the workshop is open.",
          )}
        </p>
      </Alerte>
      {a.consigne ? (
        <Carte titre={t("Consigne", "Instructions")} niveauTitre={2}>
          <p className="mp-coupure">{a.consigne}</p>
        </Carte>
      ) : null}
      <ContributionAtelier
        methodes={a.methodes}
        options={a.options}
        budgetPoints={a.points_a_repartir}
        plafondParOption={a.plafond_points_par_option}
        axes={a.axes}
        initiale={a.ma_contribution}
        cheminBase={`${cheminApiAtelierPortail(id)}/contribution`}
      />
    </div>
  );
}
