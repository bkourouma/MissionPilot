import { formaterJours } from "../../lib/format";
import { libelleClasse, libelleNiveau, ORIGINE_ETAT_LIBELLES } from "../../lib/methodes";
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
  const s = a.synthese;
  const types = Object.entries(s.elements_actifs_par_type);
  return (
    <Carte titre="Synthèse de la mission">
      <div className="mp-pile">
        <dl className="mp-apercu__chiffres">
          <Chiffre libelle="Briques actives" valeur={String(s.briques_actives)} />
          <Chiffre libelle="Briques inactives" valeur={String(s.briques_inactives)} />
          <Chiffre libelle="Durée type totale" valeur={formaterJours(s.temps_type_total_jours)} />
          <Chiffre
            libelle="Classe de risque la plus haute"
            valeur={s.classe_max ? libelleClasse(s.classe_max) : "Aucune brique active"}
          />
          <Chiffre libelle="Briques à quatre yeux" valeur={String(s.briques_quatre_yeux)} />
          <Chiffre libelle="Briques à signature" valeur={String(s.briques_signature)} />
        </dl>
        <p>{phraseTemps(s)}</p>
        {s.briques_sans_temps.length > 0 ? (
          <p className="mp-texte-doux">
            Sans temps estimé :{" "}
            <span className="mp-methode__code">
              {s.briques_sans_temps.map(lib.brique).join(", ")}
            </span>
          </p>
        ) : null}
        <section aria-labelledby="apercu-classes">
          <h3 id="apercu-classes" className="mp-section__titre">
            Briques actives par classe de risque
          </h3>
          <ul className="mp-liste-simple">
            {repartitionParClasse(s).map((c) => (
              <li key={c.classe}>
                {libelleClasse(c.classe)} : {c.nombre}
              </li>
            ))}
          </ul>
        </section>
        {s.temps_par_etape.length > 0 ? (
          <section aria-labelledby="apercu-temps">
            <h3 id="apercu-temps" className="mp-section__titre">
              Durée type par étape
            </h3>
            <ul className="mp-liste-simple">
              {s.temps_par_etape.map((t) => (
                <li key={t.etape_code}>
                  {libelleEtapeApercu(a, t.etape_code)} : {formaterJours(t.jours)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {types.length > 0 ? (
          <section aria-labelledby="apercu-elements-types">
            <h3 id="apercu-elements-types" className="mp-section__titre">
              Éléments actifs par type
            </h3>
            <ul className="mp-liste-simple">
              {types.map(([type, n]) => (
                <li key={type}>
                  {libelleTypeElement(type)} : {n}
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
  return (
    <li className={`mp-methode__brique${b.active ? "" : " mp-methode__brique--inactive"}`}>
      <h4 className="mp-methode__brique-titre">{b.libelle}</h4>
      <div className="mp-badges">
        <BadgeStatut tonalite={b.active ? "succes" : "neutre"}>
          {b.active ? "Active" : "Inactive"}
        </BadgeStatut>
        <BadgeStatut tonalite="neutre">{ORIGINE_ETAT_LIBELLES[b.origine]}</BadgeStatut>
        <BadgeStatut tonalite={tonaliteClasse(b.classe_risque)}>
          Classe {texteClasseEffective(b)}
        </BadgeStatut>
      </div>
      <p className="mp-apercu__explication">{explicationOrigine(b)}</p>
      {briqueRelevee(b) ? (
        <p className="mp-apercu__explication">
          Classe de risque relevée par une règle de contexte : {libelleClasse(b.classe_risque_base)}{" "}
          par défaut, {libelleClasse(b.classe_risque)} dans ce contexte.
        </p>
      ) : null}
      <dl className="mp-liste-def mp-liste-def--compacte">
        <div>
          <dt>Garde requise</dt>
          <dd>{texteGardeApercu(b.garde_requise)}</dd>
        </div>
        <div>
          <dt>Autonomie de l&apos;IA au plus</dt>
          <dd>{libelleNiveau(b.niveau_autonomie_max)}</dd>
        </div>
        <div>
          <dt>Temps type</dt>
          <dd>{texteTempsBrique(b.temps_type_jours)}</dd>
        </div>
        {b.adaptations.map((x) => (
          <div key={x}>
            <dt>Adaptation</dt>
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
  const actifs = a.methode.elements.filter((e) => e.actif);
  const ajustements = lignesAjustements(a.methode.ajustements, lib);
  return (
    <div className="mp-pile">
      <section aria-labelledby="apercu-elements">
        <h3 id="apercu-elements" className="mp-section__titre">
          Éléments actifs ({actifs.length})
        </h3>
        {actifs.length === 0 ? <p>Aucun élément actif.</p> : null}
        <ul className="mp-liste-simple">
          {actifs.map((e) => (
            <li key={`${e.type}-${e.code}`}>
              {libelleTypeElement(e.type)} — {e.libelle}
              {e.essentiel ? " · essentiel" : ""}
              {e.brique_code ? ` · brique ${lib.brique(e.brique_code)}` : ""}
            </li>
          ))}
        </ul>
      </section>
      {ajustements.length > 0 || a.methode.recommandations_candidates.length > 0 ? (
        <section aria-labelledby="apercu-ajustements">
          <h3 id="apercu-ajustements" className="mp-section__titre">
            Ajustements décidés par les règles
          </h3>
          <ul className="mp-liste-simple">
            {ajustements.map((l) => (
              <li key={l}>{l}</li>
            ))}
            {a.methode.recommandations_candidates.map((r) => (
              <li key={r}>Recommandation proposée : {lib.cible(r)}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ReglesEtConflits({ a, lib }: { a: ApercuMission; lib: LibellesApercu }) {
  return (
    <div className="mp-pile">
      <p>
        {a.regles_declenchees.length === 0
          ? "Aucune règle de contexte ne se déclenche : la méthode s'applique telle quelle."
          : `Règles déclenchées (${a.regles_declenchees.length}) : ${a.regles_declenchees.map(lib.regle).join(", ")}.`}
      </p>
      <JournalModulation r={a} libelles={lib} />
      {a.conflits.length > 0 ? (
        <section aria-labelledby="apercu-conflits">
          <h3 id="apercu-conflits" className="mp-section__titre">
            Conflits entre règles
          </h3>
          <ul className="mp-liste-simple">
            {a.conflits.map((c) => (
              <li key={c.cle}>
                <span className="mp-methode__code">{lib.cle(c.cle)}</span> —{" "}
                {c.resolu
                  ? `arbitré en faveur de la règle ${c.regle_retenue ? lib.regle(c.regle_retenue) : "?"}`
                  : "non résolu : deux règles de même priorité se contredisent, à trancher"}
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
  const lib = creerLibelles({
    briques: a.methode.etapes.flatMap((e) => e.briques),
    elements: a.methode.elements,
    facteurs,
    regles,
  });
  return (
    <div className="mp-pile">
      <SyntheseChiffree a={a} lib={lib} />
      <Carte titre="Étapes et briques">
        <EtapesEtBriques a={a} />
      </Carte>
      <Carte titre="Éléments et ajustements">
        <ElementsEtAjustements a={a} lib={lib} />
      </Carte>
      <Carte titre="Règles de contexte déclenchées">
        <ReglesEtConflits a={a} lib={lib} />
      </Carte>
    </div>
  );
}
