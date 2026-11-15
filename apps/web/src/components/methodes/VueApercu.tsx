import { formaterJours } from "../../lib/format";
import { libelleClasse, libelleNiveau, libelleOrigineEtat } from "../../lib/methodes";
import {
  briqueRelevee,
  creerLibelles,
  explicationOrigine,
  libelleEtapeApercu,
  libelleTypeElement,
  lignesAjustements,
  phraseTemps,
  repartitionParClasse,
  texteClasseEffective,
  texteGardeApercu,
  texteTempsBrique,
  type ApercuMission,
  type BriqueApercu,
  type LibellesApercu,
  type SourcesLibelles,
} from "../../lib/methodes-apercu";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { JournalModulation } from "./ResultatModulation";

function tonaliteClasse(c: string) {
  return c === "R3" ? "danger" : c === "R2" ? "attention" : "neutre";
}

function Chiffre({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="mp-apercu__chiffre">
      <dt>{libelle}</dt>
      <dd>{valeur}</dd>
    </div>
  );
}

/** Synthèse chiffrée, calculée par le moteur : briques, durée type, classes de risque, gardes. */
function SyntheseChiffree({ a, lib }: { a: ApercuMission; lib: LibellesApercu }) {
  const t = useT();
  const langue = useLangue();
  const s = a.synthese;
  const types = Object.entries(s.elements_actifs_par_type);
  return (
    <Carte titre={t("Synthèse de la mission", "Engagement summary")}>
      <div className="mp-pile">
        <dl className="mp-apercu__chiffres">
          <Chiffre
            libelle={t("Briques actives", "Active building blocks")}
            valeur={String(s.briques_actives)}
          />
          <Chiffre
            libelle={t("Briques inactives", "Inactive building blocks")}
            valeur={String(s.briques_inactives)}
          />
          <Chiffre
            libelle={t("Durée type totale", "Total standard duration")}
            valeur={formaterJours(s.temps_type_total_jours, langue)}
          />
          <Chiffre
            libelle={t("Classe de risque la plus haute", "Highest risk class")}
            valeur={
              s.classe_max
                ? libelleClasse(s.classe_max, langue)
                : t("Aucune brique active", "No active building block")
            }
          />
          <Chiffre
            libelle={t("Briques à quatre yeux", "Four-eyes building blocks")}
            valeur={String(s.briques_quatre_yeux)}
          />
          <Chiffre
            libelle={t("Briques à signature", "Building blocks requiring signature")}
            valeur={String(s.briques_signature)}
          />
        </dl>
        <p>{phraseTemps(s, langue)}</p>
        {s.briques_sans_temps.length > 0 ? (
          <p className="mp-texte-doux">
            {t("Sans temps estimé :", "No estimated time:")}{" "}
            <span className="mp-methode__code">
              {s.briques_sans_temps.map(lib.brique).join(", ")}
            </span>
          </p>
        ) : null}
        <section aria-labelledby="apercu-classes">
          <h3 id="apercu-classes" className="mp-section__titre">
            {t("Briques actives par classe de risque", "Active building blocks by risk class")}
          </h3>
          <ul className="mp-liste-simple">
            {repartitionParClasse(s).map((c) => (
              <li key={c.classe}>
                {libelleClasse(c.classe, langue)}
                {t(" : ", ": ")}
                {c.nombre}
              </li>
            ))}
          </ul>
        </section>
        {s.temps_par_etape.length > 0 ? (
          <section aria-labelledby="apercu-temps">
            <h3 id="apercu-temps" className="mp-section__titre">
              {t("Durée type par étape", "Standard duration by step")}
            </h3>
            <ul className="mp-liste-simple">
              {s.temps_par_etape.map((e) => (
                <li key={e.etape_code}>
                  {libelleEtapeApercu(a, e.etape_code)}
                  {t(" : ", ": ")}
                  {formaterJours(e.jours, langue)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {types.length > 0 ? (
          <section aria-labelledby="apercu-elements-types">
            <h3 id="apercu-elements-types" className="mp-section__titre">
              {t("Éléments actifs par type", "Active elements by type")}
            </h3>
            <ul className="mp-liste-simple">
              {types.map(([type, n]) => (
                <li key={type}>
                  {libelleTypeElement(type, langue)}
                  {t(" : ", ": ")}
                  {n}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Carte>
  );
}

function CarteBrique({ b }: { b: BriqueApercu }) {
  const t = useT();
  const langue = useLangue();
  return (
    <li className={`mp-methode__brique${b.active ? "" : " mp-methode__brique--inactive"}`}>
      <h4 className="mp-methode__brique-titre">{b.libelle}</h4>
      <div className="mp-badges">
        <BadgeStatut tonalite={b.active ? "succes" : "neutre"}>
          {b.active ? t("Active", "Active") : t("Inactive", "Inactive")}
        </BadgeStatut>
        <BadgeStatut tonalite="neutre">{libelleOrigineEtat(b.origine, langue)}</BadgeStatut>
        <BadgeStatut tonalite={tonaliteClasse(b.classe_risque)}>
          {t("Classe", "Class")} {texteClasseEffective(b, langue)}
        </BadgeStatut>
      </div>
      <p className="mp-apercu__explication">{explicationOrigine(b, langue)}</p>
      {briqueRelevee(b) ? (
        <p className="mp-apercu__explication">
          {t(
            `Classe de risque relevée par une règle de contexte : ${libelleClasse(b.classe_risque_base, langue)} par défaut, ${libelleClasse(b.classe_risque, langue)} dans ce contexte.`,
            `Risk class raised by a context rule: ${libelleClasse(b.classe_risque_base, langue)} by default, ${libelleClasse(b.classe_risque, langue)} in this context.`,
          )}
        </p>
      ) : null}
      <dl className="mp-liste-def mp-liste-def--compacte">
        <div>
          <dt>{t("Garde requise", "Required safeguard")}</dt>
          <dd>{texteGardeApercu(b.garde_requise, langue)}</dd>
        </div>
        <div>
          <dt>{t("Autonomie de l'IA au plus", "AI autonomy at most")}</dt>
          <dd>{libelleNiveau(b.niveau_autonomie_max, langue)}</dd>
        </div>
        <div>
          <dt>{t("Temps type", "Standard time")}</dt>
          <dd>{texteTempsBrique(b.temps_type_jours, langue)}</dd>
        </div>
        {b.adaptations.map((x) => (
          <div key={x}>
            <dt>{t("Adaptation", "Adaptation")}</dt>
            <dd>{x}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

function EtapesEtBriques({ a }: { a: ApercuMission }) {
  return (
    <div className="mp-methode">
      {a.methode.etapes.map((e) => (
        <section key={e.code} className="mp-methode__etape" aria-labelledby={`apercu-${e.code}`}>
          <h3 id={`apercu-${e.code}`} className="mp-section__titre">
            {e.libelle}
          </h3>
          {e.description ? <p className="mp-texte-doux">{e.description}</p> : null}
          <ul className="mp-methode__briques">
            {e.briques.map((b) => (
              <CarteBrique key={b.code} b={b} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ElementsEtAjustements({ a, lib }: { a: ApercuMission; lib: LibellesApercu }) {
  const t = useT();
  const langue = useLangue();
  const actifs = a.methode.elements.filter((e) => e.actif);
  const ajustements = lignesAjustements(a.methode.ajustements, lib, langue);
  return (
    <div className="mp-pile">
      <section aria-labelledby="apercu-elements">
        <h3 id="apercu-elements" className="mp-section__titre">
          {t(`Éléments actifs (${actifs.length})`, `Active elements (${actifs.length})`)}
        </h3>
        {actifs.length === 0 ? <p>{t("Aucun élément actif.", "No active element.")}</p> : null}
        <ul className="mp-liste-simple">
          {actifs.map((e) => (
            <li key={`${e.type}-${e.code}`}>
              {libelleTypeElement(e.type, langue)} — {e.libelle}
              {e.essentiel ? t(" · essentiel", " · essential") : ""}
              {e.brique_code
                ? ` · ${t("brique", "building block")} ${lib.brique(e.brique_code)}`
                : ""}
            </li>
          ))}
        </ul>
      </section>
      {ajustements.length > 0 || a.methode.recommandations_candidates.length > 0 ? (
        <section aria-labelledby="apercu-ajustements">
          <h3 id="apercu-ajustements" className="mp-section__titre">
            {t("Ajustements décidés par les règles", "Adjustments decided by the rules")}
          </h3>
          <ul className="mp-liste-simple">
            {ajustements.map((l) => (
              <li key={l}>{l}</li>
            ))}
            {a.methode.recommandations_candidates.map((r) => (
              <li key={r}>
                {t("Recommandation proposée : ", "Suggested recommendation: ")}
                {lib.cible(r)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ReglesEtConflits({ a, lib }: { a: ApercuMission; lib: LibellesApercu }) {
  const t = useT();
  const langue = useLangue();
  return (
    <div className="mp-pile">
      <p>
        {a.regles_declenchees.length === 0
          ? t(
              "Aucune règle de contexte ne se déclenche : la méthode s'applique telle quelle.",
              "No context rule triggers: the method applies as is.",
            )
          : t(
              `Règles déclenchées (${a.regles_declenchees.length}) : ${a.regles_declenchees.map(lib.regle).join(", ")}.`,
              `Rules triggered (${a.regles_declenchees.length}): ${a.regles_declenchees.map(lib.regle).join(", ")}.`,
            )}
      </p>
      <JournalModulation r={a} libelles={lib} langue={langue} />
      {a.conflits.length > 0 ? (
        <section aria-labelledby="apercu-conflits">
          <h3 id="apercu-conflits" className="mp-section__titre">
            {t("Conflits entre règles", "Conflicts between rules")}
          </h3>
          <ul className="mp-liste-simple">
            {a.conflits.map((c) => (
              <li key={c.cle}>
                <span className="mp-methode__code">{lib.cle(c.cle)}</span> —{" "}
                {c.resolu
                  ? t(
                      `arbitré en faveur de la règle ${c.regle_retenue ? lib.regle(c.regle_retenue) : "?"}`,
                      `resolved in favor of the rule ${c.regle_retenue ? lib.regle(c.regle_retenue) : "?"}`,
                    )
                  : t(
                      "non résolu : deux règles de même priorité se contredisent, à trancher",
                      "unresolved: two rules of the same priority contradict each other, to be decided",
                    )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Mission générée par la version pour le contexte saisi (lecture seule). */
export function VueApercu({
  a,
  facteurs,
  regles,
}: {
  a: ApercuMission;
  facteurs?: SourcesLibelles["facteurs"];
  regles?: SourcesLibelles["regles"];
}) {
  const t = useT();
  const langue = useLangue();
  const lib = creerLibelles(
    {
      briques: a.methode.etapes.flatMap((e) => e.briques),
      elements: a.methode.elements,
      facteurs,
      regles,
    },
    langue,
  );
  return (
    <div className="mp-pile">
      <SyntheseChiffree a={a} lib={lib} />
      <Carte titre={t("Étapes et briques", "Steps and building blocks")}>
        <EtapesEtBriques a={a} />
      </Carte>
      <Carte titre={t("Éléments et ajustements", "Elements and adjustments")}>
        <ElementsEtAjustements a={a} lib={lib} />
      </Carte>
      <Carte titre={t("Règles de contexte déclenchées", "Context rules triggered")}>
        <ReglesEtConflits a={a} lib={lib} />
      </Carte>
    </div>
  );
}
