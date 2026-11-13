import type { Metadata } from "next";
import "../../../../../../components/redressement/tableau.css";
import { EtatContexteRed } from "../../../../../../components/redressement/EtatsContexte";
import { TableauBloc } from "../../../../../../components/redressement/TableauBloc";
import {
  TableauCauses,
  TableauCloture,
  TableauCreanciers,
  TableauPlan,
  TableauSuivi,
} from "../../../../../../components/redressement/TableauAutres";
import {
  TableauCovenants,
  TableauFinancement,
  TableauTresorerie,
} from "../../../../../../components/redressement/TableauFinances";
import { TableauImprimer } from "../../../../../../components/redressement/TableauImprimer";
import { TableauIndicateurs } from "../../../../../../components/redressement/TableauIndicateurs";
import {
  VoyantPilotage,
  VoyantPilotageMotifs,
} from "../../../../../../components/redressement/VoyantPilotage";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { formaterDate } from "../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { hrefRedressement } from "../../../../../../lib/redressement";
import { chargerContexteRed } from "../../../../../../lib/redressement-serveur";
import { textesTableau } from "../../../../../../lib/redressement-tableau";
import { chargerTableauDossier } from "../../../../../../lib/redressement-tableau-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Tableau de bord du redressement", "Turnaround dashboard") };
}

/**
 * Tableau de bord du dossier (RED-15), réservé au cabinet : voyant de pilotage indicatif et ses
 * motifs, puis un bloc par domaine. Chaque chiffre vient de l'API ; un bloc absent est expliqué.
 * Mise en page imprimable pour la présentation en séance.
 */
export default async function PageTableauDeBord({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tr = await obtenirT();
  const langue = await obtenirLangue();
  const tx = textesTableau(langue);
  const ctx = await chargerContexteRed(id);
  if (ctx.etat !== "ok") {
    return (
      <EtatContexteRed
        contexte={ctx}
        missionId={id}
        hrefReessayer={hrefRedressement(id, "tableau-de-bord")}
      />
    );
  }
  const charge = await chargerTableauDossier(ctx.dossier.id);
  if (!charge.ok) {
    return (
      <EtatErreur
        titre={tr(
          "Le tableau de bord n'a pas pu être chargé.",
          "The dashboard could not be loaded.",
        )}
        message={charge.message}
        hrefReessayer={hrefRedressement(id, "tableau-de-bord")}
      />
    );
  }
  const t = charge.donnees;
  const devise = t.dossier.devise;

  return (
    <div className="mp-red">
      <section className="mp-red-section" aria-labelledby="titre-tdb">
        <div className="mp-red-entete">
          <h2 id="titre-tdb" className="mp-red-section__titre">
            {tr("Tableau de bord", "Dashboard")}
          </h2>
          <TableauImprimer />
        </div>
        <p className="mp-texte-doux">
          {t.dossier.client.raison_sociale} · {t.dossier.mission.intitule} ·{" "}
          {tr(
            `situation au ${formaterDate(t.date_calcul)}`,
            `position as of ${formaterDate(t.date_calcul, "UTC", langue)}`,
          )}
        </p>
        <p className="mp-texte-doux mp-tdb-hors-impression">{tx.interne}</p>
      </section>

      <Carte
        titre={tr("Voyant de pilotage", "Steering light")}
        niveauTitre={3}
        className="mp-tdb-bloc"
      >
        <div className="mp-pile">
          <div className="mp-tdb-voyant-grand">
            <VoyantPilotage voyant={t.voyant.voyant} />
          </div>
          <VoyantPilotageMotifs motifs={t.voyant.motifs} />
          <Alerte tonalite="info" annonce="aucune">
            <p>{t.mention || tx.mention}</p>
          </Alerte>
        </div>
      </Carte>

      <Carte
        titre={tr("Indicateurs clés", "Key indicators")}
        niveauTitre={3}
        className="mp-tdb-bloc"
      >
        <TableauIndicateurs indicateurs={t.indicateurs} />
      </Carte>

      <div className="mp-tdb-grille">
        <TableauBloc bloc="tresorerie" missionId={id} vide={t.tresorerie === null}>
          {t.tresorerie ? <TableauTresorerie tresorerie={t.tresorerie} devise={devise} /> : null}
        </TableauBloc>
        <TableauBloc bloc="covenants" missionId={id} vide={t.covenants === null}>
          {t.covenants ? <TableauCovenants c={t.covenants} /> : null}
        </TableauBloc>
        <TableauBloc bloc="financement" missionId={id} vide={t.financement === null}>
          {t.financement ? <TableauFinancement f={t.financement} devise={devise} /> : null}
        </TableauBloc>
        <TableauBloc bloc="plan" missionId={id} vide={t.plan === null}>
          {t.plan ? <TableauPlan p={t.plan} /> : null}
        </TableauBloc>
        <TableauBloc bloc="creanciers" missionId={id} vide={t.creanciers === null}>
          {t.creanciers ? <TableauCreanciers c={t.creanciers} devise={devise} /> : null}
        </TableauBloc>
        <TableauBloc bloc="causes" missionId={id} vide={t.causes === null}>
          {t.causes ? <TableauCauses c={t.causes} /> : null}
        </TableauBloc>
        <TableauBloc bloc="cloture" missionId={id} vide={t.cloture === null}>
          {t.cloture ? <TableauCloture c={t.cloture} /> : null}
        </TableauBloc>
        <TableauBloc bloc="suivi" missionId={id} vide={t.suivi === null}>
          {t.suivi ? <TableauSuivi s={t.suivi} /> : null}
        </TableauBloc>
      </div>
    </div>
  );
}
