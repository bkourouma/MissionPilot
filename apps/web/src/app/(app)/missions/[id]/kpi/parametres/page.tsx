import Link from "next/link";
import type { Metadata } from "next";
import { FormulaireParametresKpi } from "../../../../../../components/kpi/FormulaireParametresKpi";
import "../../../../../../components/kpi/kpi.css";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { classesBouton } from "../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { obtenirT } from "../../../../../../lib/i18n/serveur";
import {
  CHEMIN_PARAMETRES_KPI,
  droitsKpi,
  hrefParametresKpi,
  hrefTableauKpi,
  type ParametresKpi,
} from "../../../../../../lib/kpi";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Réglages du pilotage par KPI", "KPI management settings") };
}

/**
 * Réglages du pilotage par KPI du CABINET (rappels, délai de grâce, alerte de dégradation) :
 * lecture avec « kpi.lire », modification réservée à « cabinet.gerer » (associé). Ils
 * s'appliquent à toutes les missions.
 */
export default async function PageParametresKpi({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("kpi.lire");
  const t = await obtenirT();
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsKpi(utilisateur.roles, utilisateur.id, m);
  const p = await chargerServeur<ParametresKpi>(CHEMIN_PARAMETRES_KPI);
  const retour = (
    <Link href={hrefTableauKpi(m.id)} className={classesBouton("secondaire")}>
      {t("Revenir au tableau de bord", "Back to the dashboard")}
    </Link>
  );
  if (!p.ok) {
    return (
      <EtatErreur
        titre={t(
          "Les réglages du pilotage n'ont pas pu être chargés.",
          "The management settings could not be loaded.",
        )}
        message={p.message}
        hrefReessayer={hrefParametresKpi(m.id)}
      />
    );
  }
  const reglages = p.donnees;
  return (
    <div className="mp-kpi">
      <Carte titre={t("Réglages du pilotage par KPI", "KPI management settings")} actions={retour}>
        <div className="mp-pile">
          <p className="mp-texte-doux">
            {t(
              "Ces réglages valent pour toutes les missions du cabinet. Chaque KPI peut en plus désactiver ses propres rappels depuis sa définition.",
              "These settings apply to all the firm's engagements. Each KPI can also disable its own reminders from its definition.",
            )}
          </p>
          {!reglages.valeurs_validees ? (
            <Alerte
              tonalite="attention"
              titre={t("Valeurs de départ", "Starting values")}
              annonce="aucune"
            >
              <p>
                {t(
                  "Ces réglages sont des valeurs de départ (rappels actifs, 5 jours de grâce, dégradation après 3 périodes) qui restent à confirmer par le cabinet.",
                  "These settings are starting values (reminders on, 5 days of grace, deterioration after 3 periods) that remain to be confirmed by the firm.",
                )}
              </p>
            </Alerte>
          ) : null}
          {droits.parametres ? (
            <FormulaireParametresKpi actuel={reglages} />
          ) : (
            <>
              <dl className="mp-liste-def">
                <div>
                  <dt>{t("Rappels de saisie", "Data entry reminders")}</dt>
                  <dd>
                    {reglages.rappels_actifs
                      ? t("Actifs", "Active")
                      : t("Désactivés pour le cabinet", "Disabled for the firm")}
                  </dd>
                </div>
                <div>
                  <dt>{t("Délai de grâce", "Grace period")}</dt>
                  <dd>
                    {t(
                      `${reglages.delai_grace_jours} jour${reglages.delai_grace_jours > 1 ? "s" : ""} après la fin d'une période`,
                      `${reglages.delai_grace_jours} day${reglages.delai_grace_jours > 1 ? "s" : ""} after the end of a period`,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("Alerte de dégradation", "Deterioration alert")}</dt>
                  <dd>
                    {t(
                      `Après ${reglages.periodes_degradation} dégradation${reglages.periodes_degradation > 1 ? "s" : ""} consécutive${reglages.periodes_degradation > 1 ? "s" : ""}`,
                      `After ${reglages.periodes_degradation} consecutive deterioration${reglages.periodes_degradation > 1 ? "s" : ""}`,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("Validation", "Approval")}</dt>
                  <dd>
                    {reglages.valeurs_validees
                      ? t("Valeurs validées par le cabinet", "Values approved by the firm")
                      : t("À valider", "Pending approval")}
                  </dd>
                </div>
              </dl>
              <p className="mp-texte-doux mp-texte-petit">
                {t(
                  "Seul un associé (gestion du cabinet) modifie ces réglages.",
                  "Only a partner (firm management) can edit these settings.",
                )}
              </p>
            </>
          )}
        </div>
      </Carte>
    </div>
  );
}
