import Link from "next/link";
import type { Metadata } from "next";
import type { RedScoreVue } from "@missionpilot/shared";
import {
  BandeauIndicatif,
  EtatContexteRed,
} from "../../../../../../components/redressement/EtatsContexte";
import { FormulaireIncidents } from "../../../../../../components/redressement/FormulaireIncidents";
import { HistoriqueScores } from "../../../../../../components/redressement/HistoriqueScores";
import { ScoreAlerte } from "../../../../../../components/redressement/ScoreAlerte";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import type { PageCurseur } from "../../../../../../lib/pagination";
import {
  cheminScores,
  hrefFinancesClient,
  hrefRedressement,
  HREF_SEUILS_RED,
  MENTION_SCORE,
  raisonSansEcriture,
  TEXTE_ANALYSES_INDICATIVES,
} from "../../../../../../lib/redressement";
import { chargerContexteRed } from "../../../../../../lib/redressement-serveur";

export const metadata: Metadata = { title: "Alerte précoce" };

/**
 * Score d'alerte précoce (RED-10) : dernier score et ses douze critères, incidents de paiement,
 * « Calculer le score » et historique. Le score est une aide à la décision du consultant : la
 * mention « Indicatif » est fixe.
 */
export default async function PageAlerte({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await chargerContexteRed(id);
  if (ctx.etat !== "ok") {
    return (
      <EtatContexteRed
        contexte={ctx}
        missionId={id}
        hrefReessayer={hrefRedressement(id, "alerte")}
      />
    );
  }
  const { mission, dossier, droits } = ctx;
  const page = await chargerServeur<PageCurseur<RedScoreVue>>(cheminScores(dossier.id));
  const dernier = page.ok ? (page.donnees.elements[0] ?? null) : null;

  return (
    <div className="mp-red">
      {dossier.analyses_indicatives ? (
        <BandeauIndicatif
          texte={TEXTE_ANALYSES_INDICATIVES}
          hrefFinances={hrefFinancesClient(mission.client_id)}
        />
      ) : null}
      <p className="mp-texte-doux">{MENTION_SCORE}</p>

      {!page.ok ? (
        <EtatErreur
          titre="Les scores d'alerte n'ont pas pu être chargés."
          message={page.message}
          hrefReessayer={hrefRedressement(id, "alerte")}
        />
      ) : (
        <ScoreAlerte score={dernier} />
      )}
      <p className="mp-texte-doux mp-texte-petit">
        Les seuils se consultent et se rédigent dans{" "}
        <Link href={HREF_SEUILS_RED}>Seuils d&apos;alerte</Link>.
      </p>

      <Carte titre="Incidents de paiement">
        {droits.ecrire ? (
          <FormulaireIncidents
            key={dernier?.id ?? "aucun"}
            dossierId={dossier.id}
            derniers={dernier?.entrees.incidents ?? null}
          />
        ) : (
          <Alerte tonalite="info" annonce="aucune">
            <p>{raisonSansEcriture(mission, dossier, ctx.session.utilisateur.roles)}</p>
          </Alerte>
        )}
      </Carte>

      <section className="mp-red-section" aria-labelledby="titre-historique-scores">
        <h2 id="titre-historique-scores" className="mp-red-section__titre">
          Historique des scores
        </h2>
        {page.ok ? (
          <HistoriqueScores
            key={dernier?.id ?? "vide"}
            dossierId={dossier.id}
            initial={page.donnees.elements}
            suivant={page.donnees.suivant}
          />
        ) : null}
      </section>
    </div>
  );
}
