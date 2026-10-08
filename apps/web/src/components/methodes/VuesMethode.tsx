import {
  MOTEURS_STANDARD,
  TYPE_ELEMENT_LIBELLES,
  type TypeElementMethode,
} from "@missionpilot/shared";
import { formaterNombre } from "../../lib/format";
import {
  briquesParEtape,
  decrireCondition,
  decrireEffet,
  libelleClasse,
  libelleEtapeGarde,
  libelleNiveau,
  ORIGINE_ETAT_LIBELLES,
  type BriqueEffective,
  type BriqueVersion,
  type Facteur,
  type VersionDetail,
} from "../../lib/methodes";
import { BadgeStatut } from "../ui/BadgeStatut";
import { BoutonAction } from "./BoutonAction";

const LIBELLES_AJUSTEMENT: Record<string, string> = {
  ponderation: "Pondération",
  seuil: "Seuil",
  benchmark: "Benchmark",
  gabarit: "Gabarit",
  formulation: "Formulation",
};

function Attributs({ b }: { b: BriqueVersion }) {
  const lignes: [string, string | null][] = [
    ["Objet", b.objet],
    ["Entrées", b.entrees],
    [
      "Moteur",
      b.moteur ? (MOTEURS_STANDARD[b.moteur as keyof typeof MOTEURS_STANDARD] ?? b.moteur) : null,
    ],
    ["Agent IA autorisé", b.agent],
    ["Autonomie de l'IA au plus", libelleNiveau(b.niveau_autonomie_max)],
    ["Garde", b.garde],
    ["Sortie", b.sortie],
    ["Définition de terminé", b.definition_termine],
    [
      "Temps type",
      b.temps_type_jours === null
        ? null
        : `${formaterNombre(b.temps_type_jours)} j${b.profil_temps ? ` · ${b.profil_temps}` : ""}`,
    ],
  ];
  return (
    <dl className="mp-liste-def mp-liste-def--compacte">
      {lignes
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}

/** Contenu d'une version : étapes et briques, éléments, rubriques, règles, cas types. */
export function ContenuVersion({
  v,
  facteurs,
  editable,
}: {
  v: VersionDetail;
  facteurs: Facteur[];
  editable: boolean;
}) {
  const base = `/api/methodes/versions/${v.version.id}`;
  return (
    <div className="mp-methode">
      {briquesParEtape(v).map(({ etape, briques }) => (
        <section key={etape.id} className="mp-methode__etape" aria-labelledby={`etape-${etape.id}`}>
          <h3 id={`etape-${etape.id}`} className="mp-section__titre">
            {etape.libelle} <span className="mp-methode__code">({etape.code})</span>
          </h3>
          {etape.description ? <p className="mp-texte-doux">{etape.description}</p> : null}
          {briques.length === 0 ? <p>Aucune brique dans cette étape.</p> : null}
          <ul className="mp-methode__briques">
            {briques.map((b) => (
              <li
                key={b.id}
                className={`mp-methode__brique${b.active_par_defaut ? "" : " mp-methode__brique--inactive"}`}
              >
                <h4 className="mp-methode__brique-titre">{b.libelle}</h4>
                <span className="mp-methode__code">{b.code}</span>
                <div className="mp-badges">
                  <BadgeStatut
                    tonalite={
                      b.classe_risque === "R3"
                        ? "danger"
                        : b.classe_risque === "R2"
                          ? "attention"
                          : "neutre"
                    }
                  >
                    {libelleClasse(b.classe_risque)}
                  </BadgeStatut>
                  {b.active_par_defaut ? null : (
                    <BadgeStatut tonalite="neutre">Inactive par défaut</BadgeStatut>
                  )}
                </div>
                <Attributs b={b} />
                {editable ? (
                  <BoutonAction
                    libelle="Supprimer la brique"
                    chemin={`${base}/briques/${b.id}`}
                    methode="DELETE"
                    variante="discret"
                    icone="corbeille"
                    confirmation={{
                      question: `Supprimer la brique « ${b.libelle} » du brouillon ?`,
                      libelleConfirmation: "Oui, supprimer",
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
          {editable ? (
            <BoutonAction
              libelle="Supprimer l'étape et ses briques"
              chemin={`${base}/etapes/${etape.id}`}
              methode="DELETE"
              variante="discret"
              icone="corbeille"
              confirmation={{
                question: `Supprimer l'étape « ${etape.libelle} » et toutes ses briques ?`,
                libelleConfirmation: "Oui, supprimer",
              }}
            />
          ) : null}
        </section>
      ))}

      <section className="mp-methode__etape" aria-labelledby="titre-regles">
        <h3 id="titre-regles" className="mp-section__titre">
          Règles de modulation ({v.regles.length})
        </h3>
        {v.regles.length === 0 ? (
          <p>Aucune règle : la méthode s&apos;applique telle quelle.</p>
        ) : null}
        <ul className="mp-liste-simple">
          {v.regles.map((r) => (
            <li key={r.id} className="mp-methode__regle">
              <strong>
                {r.regle.libelle ?? r.code}{" "}
                <span className="mp-methode__code">
                  ({r.code}, priorité {r.regle.priorite})
                </span>
              </strong>
              <span>Si {decrireCondition(r.regle.condition, facteurs)}</span>
              <span>Alors : {r.regle.effets.map(decrireEffet).join(" ; ")}</span>
              {r.regle.active === false ? (
                <BadgeStatut tonalite="neutre">Désactivée</BadgeStatut>
              ) : null}
              {editable ? (
                <BoutonAction
                  libelle="Supprimer la règle"
                  chemin={`${base}/regles/${r.id}`}
                  methode="DELETE"
                  variante="discret"
                  icone="corbeille"
                  confirmation={{
                    question: `Supprimer la règle « ${r.code} » ?`,
                    libelleConfirmation: "Oui, supprimer",
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
        {v.cas_types.length > 0 ? (
          <p>Cas types : {v.cas_types.map((c) => c.libelle ?? c.code).join(" ; ")}.</p>
        ) : null}
      </section>

      <section className="mp-methode__etape" aria-labelledby="titre-elements">
        <h3 id="titre-elements" className="mp-section__titre">
          Livrables, items, KPI, initiatives, risques, gabarits ({v.elements.length})
        </h3>
        <ul className="mp-liste-simple">
          {v.elements.map((e) => (
            <li key={e.id}>
              {TYPE_ELEMENT_LIBELLES[e.type as TypeElementMethode] ?? e.type} — {e.libelle}{" "}
              <span className="mp-methode__code">({e.code})</span>
              {e.essentiel ? " · essentiel" : ""}
              {e.actif_par_defaut ? "" : " · inactif par défaut"}
              {e.brique_code ? ` · brique ${e.brique_code}` : ""}
            </li>
          ))}
        </ul>
      </section>

      {v.rubriques.length > 0 ? (
        <section className="mp-methode__etape" aria-labelledby="titre-rubriques">
          <h3 id="titre-rubriques" className="mp-section__titre">
            Rubriques à ancrages
          </h3>
          {v.rubriques.map((r) => (
            <details key={r.id} className="mp-details">
              <summary>
                {r.libelle} <span className="mp-methode__code">({r.code})</span>
              </summary>
              <ol className="mp-liste-simple">
                {r.ancrages.map((a) => (
                  <li key={a.niveau}>
                    <strong>Niveau {a.niveau} :</strong> {a.description}
                    {a.exemples.map((x) => (
                      <span key={x.contexte} className="mp-texte-doux">
                        {" "}
                        — {x.contexte} : {x.texte}
                      </span>
                    ))}
                  </li>
                ))}
              </ol>
            </details>
          ))}
        </section>
      ) : null}
    </div>
  );
}

/** Méthode effective d'une mission : briques actives ou non, origine, classe et garde. */
export function VueMethodeEffective({
  etapes,
}: {
  etapes: { code: string; libelle: string; briques: BriqueEffective[] }[];
}) {
  return (
    <div className="mp-methode">
      {etapes.map((e) => (
        <section key={e.code} className="mp-methode__etape" aria-labelledby={`me-${e.code}`}>
          <h3 id={`me-${e.code}`} className="mp-section__titre">
            {e.libelle}
          </h3>
          <ul className="mp-methode__briques">
            {e.briques.map((b) => (
              <li
                key={b.code}
                className={`mp-methode__brique${b.active ? "" : " mp-methode__brique--inactive"}`}
              >
                <h4 className="mp-methode__brique-titre">{b.libelle}</h4>
                <div className="mp-badges">
                  <BadgeStatut tonalite={b.active ? "succes" : "neutre"}>
                    {b.active ? "Active" : "Inactive"}
                  </BadgeStatut>
                  <BadgeStatut tonalite="neutre">{ORIGINE_ETAT_LIBELLES[b.origine]}</BadgeStatut>
                  <BadgeStatut
                    tonalite={
                      b.classe_risque === "R3"
                        ? "danger"
                        : b.classe_risque === "R2"
                          ? "attention"
                          : "neutre"
                    }
                  >
                    {libelleClasse(b.classe_risque)}
                    {b.classe_risque !== b.classe_risque_base
                      ? ` (relevée depuis ${b.classe_risque_base})`
                      : ""}
                  </BadgeStatut>
                </div>
                <dl className="mp-liste-def mp-liste-def--compacte">
                  <div>
                    <dt>Garde</dt>
                    <dd>
                      {b.garde_requise.etapes.length === 0
                        ? "Automatique, journalisée"
                        : b.garde_requise.etapes.map(libelleEtapeGarde).join(" → ")}
                    </dd>
                  </div>
                  <div>
                    <dt>Autonomie de l&apos;IA au plus</dt>
                    <dd>{libelleNiveau(b.niveau_autonomie_max)}</dd>
                  </div>
                  {Object.entries(b.ajustements)
                    .filter(([, v]) => v !== null)
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt>{LIBELLES_AJUSTEMENT[k] ?? k}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ))}
                  {b.adaptations.map((a) => (
                    <div key={a}>
                      <dt>Adaptation par dérogation</dt>
                      <dd>{a}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
