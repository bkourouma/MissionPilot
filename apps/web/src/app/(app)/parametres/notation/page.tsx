import type { Metadata } from "next";
import "../../../../components/notation-augmentee/notation-augmentee.css";
import { FormulaireParametresConfiance } from "../../../../components/notation-augmentee/FormulaireParametresConfiance";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../lib/format";
import {
  CHEMIN_PARAMETRES_NOTATION,
  HREF_PARAMETRES_NOTATION,
  REPONDANTS_CIBLE_PLANCHER,
  SEUIL_CONFIANCE_PLANCHER,
  droitsParametres,
  formaterSeuil,
  type ParametresNotation,
} from "../../../../lib/notation-augmentee";
import { exigerLectureNotation } from "../../../../lib/notation-serveur";

export const metadata: Metadata = { title: "Paramètres de la notation" };

/**
 * Paramètres de l'indice de confiance du cabinet (NOT-11) : seuil sous lequel une notation ne se
 * publie pas et nombre de répondants cible. Lecture pour qui voit la notation ; modification par
 * `cabinet.gerer`, jamais par un compte qui cumule le rôle d'expert métier (séparation des tâches :
 * qui publie ne règle pas le seuil qu'il doit franchir). L'API reste seule juge.
 */
export default async function PageParametresNotation() {
  const { utilisateur } = await exigerLectureNotation();
  const r = await chargerServeur<ParametresNotation>(CHEMIN_PARAMETRES_NOTATION);
  const droits = droitsParametres(utilisateur.roles);
  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Notation"
        soustitre="Indice de confiance des notations : une note n'est publiable que si son indice (couverture des items, nombre de répondants, solidité des preuves) atteint le seuil du cabinet."
      />
      <Carte titre="Indice de confiance">
        {!r.ok ? (
          <EtatErreur
            titre="Les paramètres n'ont pas pu être chargés."
            message={r.message}
            hrefReessayer={HREF_PARAMETRES_NOTATION}
          />
        ) : (
          <div className="mp-pile">
            <dl className="mp-liste-def mp-liste-def--compacte">
              <div>
                <dt>Seuil de confiance</dt>
                <dd>{formaterSeuil(r.donnees.seuil_confiance)}</dd>
              </div>
              <div>
                <dt>Répondants cibles</dt>
                <dd>{r.donnees.repondants_cible}</dd>
              </div>
              <div>
                <dt>Origine</dt>
                <dd>
                  {r.donnees.par_defaut
                    ? "Valeurs par défaut de la plateforme (aucun réglage enregistré)"
                    : `Réglage du cabinet, modifié le ${formaterDateHeure(r.donnees.modifie_le)}`}
                </dd>
              </div>
            </dl>
            <p className="mp-texte-doux">
              Planchers imposés : seuil de {formaterSeuil(SEUIL_CONFIANCE_PLANCHER)} au moins et{" "}
              {REPONDANTS_CIBLE_PLANCHER} répondants cibles au moins. Ils empêchent de vider la
              garde de publication de sa substance. Les valeurs par défaut et les planchers sont à
              calibrer au pilote.
            </p>
            {droits.modifier ? (
              <FormulaireParametresConfiance
                parametres={r.donnees}
                avertissement={droits.avertissement}
              />
            ) : (
              <Alerte tonalite="info" annonce="aucune">
                <p>{droits.explication}</p>
              </Alerte>
            )}
          </div>
        )}
      </Carte>
    </div>
  );
}
