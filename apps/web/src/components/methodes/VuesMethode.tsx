import { MOTEURS_STANDARD, type Langue, type Traduire } from "@missionpilot/shared";
import { formaterNombre } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import {
  briquesParEtape,
  decrireCondition,
  decrireEffet,
  libelleClasse,
  libelleEtapeGarde,
  libelleNiveau,
  libelleOrigineEtat,
  type BriqueEffective,
  type BriqueVersion,
  type Facteur,
  type VersionDetail,
} from "../../lib/methodes";
import { BadgeStatut } from "../ui/BadgeStatut";
import { BoutonAction } from "./BoutonAction";
import {
  ModifierBrique,
  ModifierEtape,
  ModifierRegle,
  SectionCasTypes,
  SectionElements,
  SectionRubriques,
} from "./SectionsMethode";

const LIBELLES_AJUSTEMENT: Record<string, [string, string]> = {
  ponderation: ["Pondération", "Weighting"],
  seuil: ["Seuil", "Threshold"],
  benchmark: ["Benchmark", "Benchmark"],
  gabarit: ["Gabarit", "Template"],
  formulation: ["Formulation", "Wording"],
};

function Attributs({ b, t, langue }: { b: BriqueVersion; t: Traduire; langue: Langue }) {
  const lignes: [string, string | null][] = [
    [t("Objet", "Purpose"), b.objet],
    [t("Entrées", "Inputs"), b.entrees],
    [
      t("Moteur", "Engine"),
      b.moteur ? (MOTEURS_STANDARD[b.moteur as keyof typeof MOTEURS_STANDARD] ?? b.moteur) : null,
    ],
    [t("Agent IA autorisé", "Authorized AI agent"), b.agent],
    [
      t("Autonomie de l'IA au plus", "AI autonomy at most"),
      libelleNiveau(b.niveau_autonomie_max, langue),
    ],
    [t("Garde", "Safeguard"), b.garde],
    [t("Sortie", "Output"), b.sortie],
    [t("Définition de terminé", "Definition of done"), b.definition_termine],
    [
      t("Temps type", "Standard time"),
      b.temps_type_jours === null
        ? null
        : `${formaterNombre(b.temps_type_jours, 2, langue)} ${t("j", "d")}${b.profil_temps ? ` · ${b.profil_temps}` : ""}`,
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
export async function ContenuVersion({
  v,
  facteurs,
  editable,
}: {
  v: VersionDetail;
  facteurs: Facteur[];
  editable: boolean;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const base = `/api/methodes/versions/${v.version.id}`;
  return (
    <div className="mp-methode">
      {briquesParEtape(v).map(({ etape, briques }) => (
        <section key={etape.id} className="mp-methode__etape" aria-labelledby={`etape-${etape.id}`}>
          <h3 id={`etape-${etape.id}`} className="mp-section__titre">
            {etape.libelle} <span className="mp-methode__code">({etape.code})</span>
          </h3>
          {etape.description ? <p className="mp-texte-doux">{etape.description}</p> : null}
          {briques.length === 0 ? (
            <p>{t("Aucune brique dans cette étape.", "No building block in this step.")}</p>
          ) : null}
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
                    {libelleClasse(b.classe_risque, langue)}
                  </BadgeStatut>
                  {b.active_par_defaut ? null : (
                    <BadgeStatut tonalite="neutre">
                      {t("Inactive par défaut", "Inactive by default")}
                    </BadgeStatut>
                  )}
                </div>
                <Attributs b={b} t={t} langue={langue} />
                {editable ? <ModifierBrique v={v} brique={b} /> : null}
                {editable ? (
                  <BoutonAction
                    libelle={t("Supprimer la brique", "Delete the building block")}
                    chemin={`${base}/briques/${b.id}`}
                    methode="DELETE"
                    variante="discret"
                    icone="corbeille"
                    confirmation={{
                      question: t(
                        `Supprimer la brique « ${b.libelle} » du brouillon ?`,
                        `Delete the building block "${b.libelle}" from the draft?`,
                      ),
                      libelleConfirmation: t("Oui, supprimer", "Yes, delete"),
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
          {editable ? <ModifierEtape v={v} etape={etape} /> : null}
          {editable ? (
            <BoutonAction
              libelle={t(
                "Supprimer l'étape et ses briques",
                "Delete the step and its building blocks",
              )}
              chemin={`${base}/etapes/${etape.id}`}
              methode="DELETE"
              variante="discret"
              icone="corbeille"
              confirmation={{
                question: t(
                  `Supprimer l'étape « ${etape.libelle} » et toutes ses briques ?`,
                  `Delete the step "${etape.libelle}" and all its building blocks?`,
                ),
                libelleConfirmation: t("Oui, supprimer", "Yes, delete"),
              }}
            />
          ) : null}
        </section>
      ))}

      <section className="mp-methode__etape" aria-labelledby="titre-regles">
        <h3 id="titre-regles" className="mp-section__titre">
          {t(`Règles de modulation (${v.regles.length})`, `Modulation rules (${v.regles.length})`)}
        </h3>
        {v.regles.length === 0 ? (
          <p>
            {t(
              "Aucune règle : la méthode s'applique telle quelle.",
              "No rule: the method applies as is.",
            )}
          </p>
        ) : null}
        <ul className="mp-liste-simple">
          {v.regles.map((r) => (
            <li key={r.id} className="mp-methode__regle">
              <strong>
                {r.regle.libelle ?? r.code}{" "}
                <span className="mp-methode__code">
                  ({r.code}, {t("priorité", "priority")} {r.regle.priorite})
                </span>
              </strong>
              <span>
                {t("Si", "If")} {decrireCondition(r.regle.condition, facteurs, langue)}
              </span>
              <span>
                {t("Alors : ", "Then: ")}
                {r.regle.effets.map((e) => decrireEffet(e, langue)).join(t(" ; ", "; "))}
              </span>
              {r.regle.active === false ? (
                <BadgeStatut tonalite="neutre">{t("Désactivée", "Disabled")}</BadgeStatut>
              ) : null}
              {editable ? <ModifierRegle v={v} regle={r} facteurs={facteurs} /> : null}
              {editable ? (
                <BoutonAction
                  libelle={t("Supprimer la règle", "Delete the rule")}
                  chemin={`${base}/regles/${r.id}`}
                  methode="DELETE"
                  variante="discret"
                  icone="corbeille"
                  confirmation={{
                    question: t(
                      `Supprimer la règle « ${r.code} » ?`,
                      `Delete the rule "${r.code}"?`,
                    ),
                    libelleConfirmation: t("Oui, supprimer", "Yes, delete"),
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <SectionCasTypes v={v} editable={editable} facteurs={facteurs} />
      <SectionElements v={v} editable={editable} />
      <SectionRubriques v={v} editable={editable} />
    </div>
  );
}

/** Méthode effective d'une mission : briques actives ou non, origine, classe et garde. */
export async function VueMethodeEffective({
  etapes,
}: {
  etapes: { code: string; libelle: string; briques: BriqueEffective[] }[];
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
                    {b.active ? t("Active", "Active") : t("Inactive", "Inactive")}
                  </BadgeStatut>
                  <BadgeStatut tonalite="neutre">
                    {libelleOrigineEtat(b.origine, langue)}
                  </BadgeStatut>
                  <BadgeStatut
                    tonalite={
                      b.classe_risque === "R3"
                        ? "danger"
                        : b.classe_risque === "R2"
                          ? "attention"
                          : "neutre"
                    }
                  >
                    {libelleClasse(b.classe_risque, langue)}
                    {b.classe_risque !== b.classe_risque_base
                      ? ` (${t("relevée depuis", "raised from")} ${b.classe_risque_base})`
                      : ""}
                  </BadgeStatut>
                </div>
                <dl className="mp-liste-def mp-liste-def--compacte">
                  <div>
                    <dt>{t("Garde", "Safeguard")}</dt>
                    <dd>
                      {b.garde_requise.etapes.length === 0
                        ? t("Automatique, journalisée", "Automatic, logged")
                        : b.garde_requise.etapes
                            .map((e) => libelleEtapeGarde(e, langue))
                            .join(" → ")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Autonomie de l'IA au plus", "AI autonomy at most")}</dt>
                    <dd>{libelleNiveau(b.niveau_autonomie_max, langue)}</dd>
                  </div>
                  {Object.entries(b.ajustements)
                    .filter(([, v]) => v !== null)
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt>{LIBELLES_AJUSTEMENT[k] ? t(...LIBELLES_AJUSTEMENT[k]) : k}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ))}
                  {b.adaptations.map((a) => (
                    <div key={a}>
                      <dt>{t("Adaptation par dérogation", "Adaptation by waiver")}</dt>
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
