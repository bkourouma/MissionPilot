import type { Metadata } from "next";
import { CartesSynthese } from "../../../../../components/redressement/CarteSynthese";
import {
  EtatContexteRed,
  BandeauIndicatif,
} from "../../../../../components/redressement/EtatsContexte";
import { FormulaireOuvertureDossier } from "../../../../../components/redressement/FormulaireOuvertureDossier";
import {
  ActionsStatutDossier,
  FormulaireDossier,
} from "../../../../../components/redressement/FormulaireDossier";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatVide } from "../../../../../components/ui/EtatListe";
import {
  hrefFinancesClient,
  hrefRedressement,
  raisonSansEcriture,
  TEXTE_ANALYSES_INDICATIVES,
  TEXTE_ANALYSES_INDICATIVES_EN,
} from "../../../../../lib/redressement";
import { chargerContexteRed } from "../../../../../lib/redressement-serveur";
import { Alerte } from "../../../../../components/ui/Alerte";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Redressement de la mission", "Engagement turnaround") };
}

/**
 * Synthèse du dossier de redressement d'une mission : ouverture si absent, sinon les cartes
 * Urgence, Alerte précoce, Trésorerie, Créanciers et Plan. Chiffres : ceux de l'API (moteurs).
 */
export default async function PageSyntheseRedressement({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const ctx = await chargerContexteRed(id);
  if (ctx.etat === "mission_indisponible" || ctx.etat === "erreur") {
    return <EtatContexteRed contexte={ctx} missionId={id} hrefReessayer={hrefRedressement(id)} />;
  }
  if (ctx.etat === "absent") {
    const { mission, droits } = ctx;
    return (
      <EtatVide
        titre={t(
          "Aucun dossier de redressement pour cette mission.",
          "No turnaround file for this engagement.",
        )}
        icone="attention"
      >
        {droits.ouvrir ? (
          <FormulaireOuvertureDossier
            missionId={id}
            intituleInitial={`${t("Redressement", "Turnaround")} — ${mission.client_raison_sociale}`}
          />
        ) : (
          <p>
            {t(
              "Le directeur ou le chef de mission ouvre le dossier.",
              "The engagement director or manager opens the file.",
            )}
          </p>
        )}
      </EtatVide>
    );
  }
  const { mission, dossier, droits } = ctx;
  return (
    <>
      {dossier.analyses_indicatives ? (
        <BandeauIndicatif
          texte={t(TEXTE_ANALYSES_INDICATIVES, TEXTE_ANALYSES_INDICATIVES_EN)}
          hrefFinances={hrefFinancesClient(mission.client_id)}
        />
      ) : null}
      <CartesSynthese missionId={id} dossier={dossier} />
      {dossier.statut === "clos" ? (
        <Alerte tonalite="info" titre={t("Dossier clos", "File closed")} annonce="aucune">
          <p>{dossier.motif_cloture ?? t("Aucun motif enregistré.", "No reason recorded.")}</p>
        </Alerte>
      ) : null}
      {dossier.statut !== "clos" && (droits.ecrire || droits.valider) ? (
        <Carte titre={t("Statut du dossier", "File status")}>
          <ActionsStatutDossier
            dossierId={dossier.id}
            statut={dossier.statut}
            peutEcrire={droits.ecrire}
            peutValider={droits.valider}
          />
        </Carte>
      ) : null}
      {droits.ecrire ? (
        <Carte titre={t("Modifier le dossier", "Edit the file")}>
          <FormulaireDossier
            dossierId={dossier.id}
            intitule={dossier.intitule}
            secteur={dossier.secteur}
          />
        </Carte>
      ) : (
        <p className="mp-texte-doux">
          {raisonSansEcriture(mission, dossier, ctx.session.utilisateur.roles, langue)}
        </p>
      )}
    </>
  );
}
