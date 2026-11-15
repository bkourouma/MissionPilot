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
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import type { PageCurseur } from "../../../../../../lib/pagination";
import {
  cheminScores,
  hrefFinancesClient,
  hrefRedressement,
  HREF_SEUILS_RED,
  MENTION_SCORE,
  MENTION_SCORE_EN,
  raisonSansEcriture,
  TEXTE_ANALYSES_INDICATIVES,
  TEXTE_ANALYSES_INDICATIVES_EN,
} from "../../../../../../lib/redressement";
import { chargerContexteRed } from "../../../../../../lib/redressement-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Alerte précoce", "Early warning") };
}

/**
 * Score d'alerte précoce (RED-10) : dernier score et ses douze critères, incidents de paiement,
 * « Calculer le score » et historique. Le score est une aide à la décision du consultant : la
 * mention « Indicatif » est fixe.
 */
export default async function PageAlerte({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
          texte={t(TEXTE_ANALYSES_INDICATIVES, TEXTE_ANALYSES_INDICATIVES_EN)}
          hrefFinances={hrefFinancesClient(mission.client_id)}
        />
      ) : null}
      <p className="mp-texte-doux">{t(MENTION_SCORE, MENTION_SCORE_EN)}</p>

      {!page.ok ? (
        <EtatErreur
          titre={t(
            "Les scores d'alerte n'ont pas pu être chargés.",
            "The alert scores could not be loaded.",
          )}
          message={page.message}
          hrefReessayer={hrefRedressement(id, "alerte")}
        />
      ) : (
        <ScoreAlerte score={dernier} />
      )}
      <p className="mp-texte-doux mp-texte-petit">
        {t("Les seuils se consultent et se rédigent dans", "Thresholds are viewed and drafted in")}{" "}
        <Link href={HREF_SEUILS_RED}>{t("Seuils d'alerte", "Alert thresholds")}</Link>.
      </p>

      <Carte titre={t("Incidents de paiement", "Payment incidents")}>
        {droits.ecrire ? (
          <FormulaireIncidents
            key={dernier?.id ?? "aucun"}
            dossierId={dossier.id}
            derniers={dernier?.entrees.incidents ?? null}
          />
        ) : (
          <Alerte tonalite="info" annonce="aucune">
            <p>{raisonSansEcriture(mission, dossier, ctx.session.utilisateur.roles, langue)}</p>
          </Alerte>
        )}
      </Carte>

      <section className="mp-red-section" aria-labelledby="titre-historique-scores">
        <h2 id="titre-historique-scores" className="mp-red-section__titre">
          {t("Historique des scores", "Score history")}
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
