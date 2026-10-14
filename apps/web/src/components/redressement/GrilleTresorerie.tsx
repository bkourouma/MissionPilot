import type { RedProjectionVue, RedSemaineTresorerieVue } from "@missionpilot/shared";
import { formaterMontantMineur, type Devise } from "../../lib/format";
import {
  abregerSemaine,
  formaterSemaine,
  libelleCategorieFlux,
  libelleSensFlux,
} from "../../lib/redressement";
import { Icone } from "../ui/Icone";

interface LigneCategorie {
  sens: "encaissement" | "decaissement";
  categorie: string;
}

/** Catégories qui portent un montant prévu ou réalisé sur au moins une semaine, par sens. */
function categoriesPresentes(semaines: readonly RedSemaineTresorerieVue[]): LigneCategorie[] {
  const vues = new Map<string, LigneCategorie>();
  for (const s of semaines) {
    for (const c of s.par_categorie) {
      if (c.prevu !== 0 || (c.realise !== null && c.realise !== 0)) {
        vues.set(`${c.sens}:${c.categorie}`, { sens: c.sens, categorie: c.categorie });
      }
    }
  }
  const toutes = [...vues.values()];
  return [
    ...toutes.filter((c) => c.sens === "encaissement"),
    ...toutes.filter((c) => c.sens === "decaissement"),
  ];
}

function montantPrevu(s: RedSemaineTresorerieVue, l: LigneCategorie): number {
  return s.par_categorie.find((c) => c.sens === l.sens && c.categorie === l.categorie)?.prevu ?? 0;
}

function Tension({ tension }: { tension: boolean }) {
  return tension ? (
    <span className="mp-red-grille__tension">
      <Icone nom="attention" taille={16} />
      <span>Tension</span>
    </span>
  ) : (
    <span className="mp-texte-doux">—</span>
  );
}

/**
 * Grille des 13 semaines (SPEC-3a §10.3) : prévisions par catégorie, totaux, réalisé, écart et
 * solde retenu, tous fournis par l'API (moteur de trésorerie). Une semaine de tension porte
 * l'icône d'attention ET le texte « Tension ». Sous 640 px, la grille devient une liste de cartes
 * par semaine (CSS) ; les deux rendus portent les mêmes valeurs.
 */
export function GrilleTresorerie({
  projection,
  devise,
}: {
  projection: RedProjectionVue;
  devise: Devise;
}) {
  const semaines = projection.semaines;
  const lignes = categoriesPresentes(semaines);
  const m = (v: number | null) => formaterMontantMineur(v, devise);
  return (
    <div className="mp-red-grille">
      <div
        className="mp-red-grille__tableau mp-red-defilement"
        role="region"
        aria-label="Grille de trésorerie à 13 semaines"
        tabIndex={0}
      >
        <table className="mp-red-grille__table">
          <caption className="mp-visuellement-cache">
            Trésorerie à 13 semaines : prévu, réalisé, écart et solde retenu par semaine
          </caption>
          <thead>
            <tr>
              <th scope="col">Ligne</th>
              {semaines.map((s) => (
                <th key={s.semaine} scope="col">
                  {abregerSemaine(s.semaine)}
                  <span className="mp-red-grille__dates">{formaterSemaine(s.debut, s.fin)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={`${l.sens}:${l.categorie}`}>
                <th scope="row">
                  {libelleSensFlux(l.sens)} : {libelleCategorieFlux(l.categorie)}
                </th>
                {semaines.map((s) => (
                  <td key={s.semaine}>{m(montantPrevu(s, l))}</td>
                ))}
              </tr>
            ))}
            <tr className="mp-red-grille__ligne--total">
              <th scope="row">Encaissements prévus</th>
              {semaines.map((s) => (
                <td key={s.semaine}>{m(s.encaissements_prevus)}</td>
              ))}
            </tr>
            <tr className="mp-red-grille__ligne--total">
              <th scope="row">Décaissements prévus</th>
              {semaines.map((s) => (
                <td key={s.semaine}>{m(s.decaissements_prevus)}</td>
              ))}
            </tr>
            <tr className="mp-red-grille__ligne--total">
              <th scope="row">Flux net prévu</th>
              {semaines.map((s) => (
                <td key={s.semaine}>{m(s.flux_net_prevu)}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Solde de clôture prévu</th>
              {semaines.map((s) => (
                <td key={s.semaine}>{m(s.solde_cloture_prevu)}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Réalisé : flux net</th>
              {semaines.map((s) => (
                <td key={s.semaine}>{s.realise ? m(s.realise.flux_net) : "—"}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Solde bancaire constaté</th>
              {semaines.map((s) => (
                <td key={s.semaine}>{s.realise ? m(s.realise.solde_constate) : "—"}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Écart sur le flux net</th>
              {semaines.map((s) => (
                <td key={s.semaine}>{m(s.ecart_flux_net)}</td>
              ))}
            </tr>
            <tr className="mp-red-grille__ligne--total">
              <th scope="row">Solde de clôture retenu</th>
              {semaines.map((s) => (
                <td key={s.semaine}>{m(s.solde_cloture_retenu)}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Situation</th>
              {semaines.map((s) => (
                <td key={s.semaine}>
                  <Tension tension={s.tension} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <ul className="mp-red-grille__cartes" aria-label="Trésorerie par semaine">
        {semaines.map((s) => (
          <li
            key={s.semaine}
            className={s.tension ? "mp-red-semaine mp-red-semaine--tension" : "mp-red-semaine"}
          >
            <p className="mp-red-semaine__titre">
              <span>Semaine {s.semaine}</span>
              <span className="mp-texte-doux mp-texte-petit">
                {formaterSemaine(s.debut, s.fin)}
              </span>
            </p>
            {s.tension ? <Tension tension /> : null}
            <dl>
              <div>
                <dt>Encaissements prévus</dt>
                <dd>{m(s.encaissements_prevus)}</dd>
              </div>
              <div>
                <dt>Décaissements prévus</dt>
                <dd>{m(s.decaissements_prevus)}</dd>
              </div>
              <div>
                <dt>Flux net prévu</dt>
                <dd>{m(s.flux_net_prevu)}</dd>
              </div>
              <div>
                <dt>Solde de clôture prévu</dt>
                <dd>{m(s.solde_cloture_prevu)}</dd>
              </div>
              <div>
                <dt>Réalisé : flux net</dt>
                <dd>{s.realise ? m(s.realise.flux_net) : "—"}</dd>
              </div>
              <div>
                <dt>Écart sur le flux net</dt>
                <dd>{m(s.ecart_flux_net)}</dd>
              </div>
              <div>
                <dt>Solde de clôture retenu</dt>
                <dd>{m(s.solde_cloture_retenu)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
