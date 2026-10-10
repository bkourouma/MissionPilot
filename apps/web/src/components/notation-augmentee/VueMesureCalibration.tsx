import { BadgeStatut } from "../ui/BadgeStatut";
import { Tableau } from "../ui/Tableau";
import { formaterNombre } from "../../lib/format";
import {
  formaterPointsSignes,
  formaterRatio,
  libelleAccord,
  phraseBiais,
  type MesureCalibrationVue,
} from "../../lib/notation-augmentee";
import "./notation-augmentee.css";

/**
 * Mesure d'écart d'une session (moteur `mesurerCalibration`) : accord, cas à discuter, biais par
 * évaluateur. Tous les chiffres viennent de l'API ; ici, seulement la présentation. Avant la
 * clôture la mesure est PARTIELLE : limitée aux cas que l'expert a lui-même cotés.
 */
export function VueMesureCalibration({
  mesure,
  libellesCas,
  partielle,
}: {
  mesure: MesureCalibrationVue;
  libellesCas: ReadonlyMap<string, string>;
  partielle: boolean;
}) {
  const libelle = (code: string) => libellesCas.get(code) ?? code;
  return (
    <div className="mp-pile">
      {partielle ? (
        <p className="mp-texte-doux">
          Mesure partielle : elle ne porte que sur les cas que vous avez cotés. La mesure complète
          apparaît à la clôture de la session.
        </p>
      ) : null}
      <dl className="mp-na-synthese">
        <div>
          <dt>Taux d&apos;accord</dt>
          <dd>{formaterRatio(mesure.taux_accord)}</dd>
        </div>
        <div>
          <dt>Écart moyen (niveaux)</dt>
          <dd>{formaterNombre(mesure.ecart_moyen, 2)}</dd>
        </div>
        <div>
          <dt>Cas doublement cotés</dt>
          <dd>{mesure.cas_doublement_cotes}</dd>
        </div>
        <div>
          <dt>Cas en accord</dt>
          <dd>{mesure.cas_en_accord}</dd>
        </div>
        <div>
          <dt>Tolérance (niveaux)</dt>
          <dd>{mesure.tolerance}</dd>
        </div>
      </dl>

      {mesure.a_discuter.length > 0 ? (
        <div className="mp-pile">
          <p className="mp-na-liste__titre">Cas à discuter en séance de calibrage</p>
          <ul className="mp-na-cotations">
            {mesure.a_discuter.map((c) => (
              <li key={c}>{libelle(c)}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mp-texte-doux">Aucun cas à discuter pour le moment.</p>
      )}

      <Tableau
        legende="Mesure par cas"
        legendeVisible
        cleLigne={(c) => c.cas}
        lignes={mesure.cas}
        colonnes={[
          { cle: "cas", entete: "Cas", rendu: (c) => libelle(c.cas) },
          { cle: "cotations", entete: "Cotations", alignement: "droite" },
          { cle: "min", entete: "Niveau min.", alignement: "droite" },
          { cle: "max", entete: "Niveau max.", alignement: "droite" },
          { cle: "ecart", entete: "Écart", alignement: "droite" },
          {
            cle: "mediane",
            entete: "Médiane",
            alignement: "droite",
            rendu: (c) => formaterNombre(c.mediane, 1),
          },
          {
            cle: "accord",
            entete: "Accord",
            rendu: (c) => {
              const a = libelleAccord(c.accord);
              return <BadgeStatut tonalite={a.tonalite}>{a.libelle}</BadgeStatut>;
            },
          },
        ]}
      />

      <Tableau
        legende="Mesure par évaluateur"
        legendeVisible
        cleLigne={(e) => e.evaluateur.id}
        lignes={mesure.evaluateurs}
        colonnes={[
          {
            cle: "evaluateur",
            entete: "Évaluateur",
            rendu: (e) => e.evaluateur.nom ?? "Un membre du cabinet",
          },
          { cle: "cotations", entete: "Cotations", alignement: "droite" },
          { cle: "cas_compares", entete: "Cas comparés", alignement: "droite" },
          {
            cle: "biais",
            entete: "Biais (niveaux)",
            alignement: "droite",
            rendu: (e) => (e.biais === null ? "—" : formaterPointsSignes(e.biais)),
          },
          {
            cle: "ecart_absolu_moyen",
            entete: "Écart absolu moyen",
            alignement: "droite",
            rendu: (e) => formaterNombre(e.ecart_absolu_moyen, 2),
          },
          { cle: "lecture", entete: "Lecture", rendu: (e) => phraseBiais(e.biais) },
        ]}
      />
      <p className="mp-texte-doux mp-texte-petit">
        Le biais est l&apos;écart moyen à la médiane du cas, sur les cas doublement cotés : positif,
        l&apos;évaluateur est plus généreux que ses pairs.
      </p>
    </div>
  );
}
