import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Alerte } from "../ui/Alerte";
import { Tableau } from "../ui/Tableau";
import { libelleDevise } from "../../lib/format";
import {
  AVERTISSEMENT_GROUPE,
  formaterFiabiliteGroupe,
  formaterPart,
  libelleControle,
  libelleMotifExclusion,
  libelleNoeud,
  lignesIndicateurs,
  type GroupeApi,
  type IndicateursConsolides,
  type LigneIndicateur,
} from "../../lib/dossier-groupes";
import "./groupe.css";

function TableauIndicateurs({
  legende,
  valeurs,
  groupe,
}: {
  legende: string;
  valeurs: IndicateursConsolides;
  groupe: GroupeApi;
}) {
  const lignes = lignesIndicateurs(valeurs, groupe.consolidation.devise, groupe.indicateurs);
  return (
    <Tableau<LigneIndicateur>
      legende={legende}
      legendeVisible
      lignes={lignes}
      cleLigne={(l) => l.cle}
      colonnes={[
        { cle: "libelle", entete: "Indicateur", rendu: (l) => l.libelle },
        { cle: "valeur", entete: "Valeur", alignement: "droite", rendu: (l) => l.valeur },
      ]}
    />
  );
}

/**
 * Consolidation simple du groupe (DOS-05) : deux lectures (intégrale et proportionnelle), le
 * périmètre et ses exclusions. Tous les chiffres viennent du moteur par l'API ; la devise du
 * groupe est celle de la racine ; les entités XOF, XAF ou EUR sont converties par le moteur à la parité
 * fixe, l'USD (sans taux validé) est exclu.
 */
export function ConsolidationGroupe({ groupe }: { groupe: GroupeApi }) {
  const c = groupe.consolidation;
  return (
    <section aria-labelledby="titre-consolidation" className="mp-groupe">
      <h2 id="titre-consolidation" className="mp-carte__titre">
        Consolidation simple
        {c.exercice !== null ? ` · exercice ${c.exercice}` : ""}
        {c.devise ? ` · ${libelleDevise(c.devise)}` : ""}{" "}
        {c.partielle ? (
          <BadgeStatut tonalite="attention">Consolidation partielle</BadgeStatut>
        ) : null}
      </h2>

      <Alerte tonalite="attention" annonce="aucune" titre={AVERTISSEMENT_GROUPE}>
        <ul className="mp-groupe-regles">
          {groupe.regles.textes.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </Alerte>

      {c.partielle ? (
        <Alerte tonalite="attention" annonce="aucune">
          <p>
            Au moins une entité du groupe est exclue du calcul : les totaux ci-dessous sous-estiment
            le groupe. Le détail figure dans le périmètre.
          </p>
        </Alerte>
      ) : null}

      <div className="mp-groupe-consolidation">
        <Carte titre="Consolidation intégrale" niveauTitre={3}>
          <TableauIndicateurs
            legende="Consolidation intégrale (entités contrôlées à 100 %)"
            valeurs={c.integrale}
            groupe={groupe}
          />
        </Carte>
        <Carte titre="Consolidation proportionnelle" niveauTitre={3}>
          <TableauIndicateurs
            legende="Consolidation proportionnelle (pondérée par la part détenue)"
            valeurs={c.proportionnelle}
            groupe={groupe}
          />
        </Carte>
      </div>

      <Carte titre="Périmètre" niveauTitre={3}>
        <p>
          Fiabilité moyenne pondérée par la part cumulée :{" "}
          <strong>{formaterFiabiliteGroupe(c.fiabilite.moyenne_ponderee)}</strong>
        </p>
        <h4>Entités incluses</h4>
        {c.perimetre.inclus.length === 0 ? (
          <p>Aucune entité incluse.</p>
        ) : (
          <ul className="mp-groupe-perimetre">
            {c.perimetre.inclus.map((e) => (
              <li key={e.id}>
                <strong>{e.nom}</strong> — part cumulée {formaterPart(e.part_cumulee_bps)} ·{" "}
                {libelleControle(e.controlee)}
              </li>
            ))}
          </ul>
        )}
        {(c.conversions ?? []).length > 0 ? (
          <>
            <h4>Entités converties</h4>
            <ul className="mp-groupe-perimetre">
              {(c.conversions ?? []).map((v) => (
                <li key={v.id}>
                  <strong>{v.nom}</strong> — convertie de {v.de} en {v.vers} (parité fixe)
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <h4>Entités exclues</h4>
        {c.perimetre.exclus.length === 0 ? (
          <p>Aucune entité exclue.</p>
        ) : (
          <ul className="mp-groupe-perimetre">
            {c.perimetre.exclus.map((e, i) => (
              <li key={`${e.id ?? "anonyme"}-${i}`}>
                <strong>{libelleNoeud({ visible: Boolean(e.id), nom: e.nom })}</strong> —{" "}
                {libelleMotifExclusion(e.motif)}
              </li>
            ))}
          </ul>
        )}
      </Carte>
    </section>
  );
}
