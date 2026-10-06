import Link from "next/link";
import type { Metadata } from "next";
import { FormulaireParametresKpi } from "../../../../../../components/kpi/FormulaireParametresKpi";
import "../../../../../../components/kpi/kpi.css";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { classesBouton } from "../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import {
  CHEMIN_PARAMETRES_KPI,
  droitsKpi,
  hrefParametresKpi,
  hrefTableauKpi,
  type ParametresKpi,
} from "../../../../../../lib/kpi";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Réglages du pilotage par KPI" };

/**
 * Réglages du pilotage par KPI du CABINET (rappels, délai de grâce, alerte de dégradation) :
 * lecture avec « kpi.lire », modification réservée à « cabinet.gerer » (associé). Ils
 * s'appliquent à toutes les missions.
 */
export default async function PageParametresKpi({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("kpi.lire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsKpi(utilisateur.roles, utilisateur.id, m);
  const p = await chargerServeur<ParametresKpi>(CHEMIN_PARAMETRES_KPI);
  const retour = (
    <Link href={hrefTableauKpi(m.id)} className={classesBouton("secondaire")}>
      Revenir au tableau de bord
    </Link>
  );
  if (!p.ok) {
    return (
      <EtatErreur
        titre="Les réglages du pilotage n'ont pas pu être chargés."
        message={p.message}
        hrefReessayer={hrefParametresKpi(m.id)}
      />
    );
  }
  const reglages = p.donnees;
  return (
    <div className="mp-kpi">
      <Carte titre="Réglages du pilotage par KPI" actions={retour}>
        <div className="mp-pile">
          <p className="mp-texte-doux">
            Ces réglages valent pour toutes les missions du cabinet. Chaque KPI peut en plus
            désactiver ses propres rappels depuis sa définition.
          </p>
          {!reglages.valeurs_validees ? (
            <Alerte tonalite="attention" titre="Valeurs de départ" annonce="aucune">
              <p>
                Ces réglages sont des valeurs de départ (rappels actifs, 5 jours de grâce,
                dégradation après 3 périodes) qui restent à confirmer par le cabinet.
              </p>
            </Alerte>
          ) : null}
          {droits.parametres ? (
            <FormulaireParametresKpi actuel={reglages} />
          ) : (
            <>
              <dl className="mp-liste-def">
                <div>
                  <dt>Rappels de saisie</dt>
                  <dd>{reglages.rappels_actifs ? "Actifs" : "Désactivés pour le cabinet"}</dd>
                </div>
                <div>
                  <dt>Délai de grâce</dt>
                  <dd>
                    {reglages.delai_grace_jours} jour{reglages.delai_grace_jours > 1 ? "s" : ""}{" "}
                    après la fin d&apos;une période
                  </dd>
                </div>
                <div>
                  <dt>Alerte de dégradation</dt>
                  <dd>
                    Après {reglages.periodes_degradation} dégradation
                    {reglages.periodes_degradation > 1 ? "s" : ""} consécutive
                    {reglages.periodes_degradation > 1 ? "s" : ""}
                  </dd>
                </div>
                <div>
                  <dt>Validation</dt>
                  <dd>
                    {reglages.valeurs_validees ? "Valeurs validées par le cabinet" : "À valider"}
                  </dd>
                </div>
              </dl>
              <p className="mp-texte-doux mp-texte-petit">
                Seul un associé (gestion du cabinet) modifie ces réglages.
              </p>
            </>
          )}
        </div>
      </Carte>
    </div>
  );
}
