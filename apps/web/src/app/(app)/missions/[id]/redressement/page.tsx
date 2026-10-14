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
} from "../../../../../lib/redressement";
import { chargerContexteRed } from "../../../../../lib/redressement-serveur";
import { Alerte } from "../../../../../components/ui/Alerte";

export const metadata: Metadata = { title: "Redressement de la mission" };

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
  const ctx = await chargerContexteRed(id);
  if (ctx.etat === "mission_indisponible" || ctx.etat === "erreur") {
    return <EtatContexteRed contexte={ctx} missionId={id} hrefReessayer={hrefRedressement(id)} />;
  }
  if (ctx.etat === "absent") {
    const { mission, droits } = ctx;
    return (
      <EtatVide titre="Aucun dossier de redressement pour cette mission." icone="attention">
        {droits.ouvrir ? (
          <FormulaireOuvertureDossier
            missionId={id}
            intituleInitial={`Redressement — ${mission.client_raison_sociale}`}
          />
        ) : (
          <p>Le directeur ou le chef de mission ouvre le dossier.</p>
        )}
      </EtatVide>
    );
  }
  const { mission, dossier, droits } = ctx;
  return (
    <>
      {dossier.analyses_indicatives ? (
        <BandeauIndicatif
          texte={TEXTE_ANALYSES_INDICATIVES}
          hrefFinances={hrefFinancesClient(mission.client_id)}
        />
      ) : null}
      <CartesSynthese missionId={id} dossier={dossier} />
      {dossier.statut === "clos" ? (
        <Alerte tonalite="info" titre="Dossier clos" annonce="aucune">
          <p>{dossier.motif_cloture ?? "Aucun motif enregistré."}</p>
        </Alerte>
      ) : null}
      {dossier.statut !== "clos" && (droits.ecrire || droits.valider) ? (
        <Carte titre="Statut du dossier">
          <ActionsStatutDossier
            dossierId={dossier.id}
            statut={dossier.statut}
            peutEcrire={droits.ecrire}
            peutValider={droits.valider}
          />
        </Carte>
      ) : null}
      {droits.ecrire ? (
        <Carte titre="Modifier le dossier">
          <FormulaireDossier
            dossierId={dossier.id}
            intitule={dossier.intitule}
            secteur={dossier.secteur}
          />
        </Carte>
      ) : (
        <p className="mp-texte-doux">
          {raisonSansEcriture(mission, dossier, ctx.session.utilisateur.roles)}
        </p>
      )}
    </>
  );
}
