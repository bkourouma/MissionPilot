import Link from "next/link";
import { aPermission } from "@missionpilot/shared";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import {
  ancreSource,
  formaterRenvois,
  hrefAncreSource,
  hrefOuvertureCitation,
  indexerSources,
  libelleFiabiliteSource,
  libelleSoliditeCitee,
  libelleTypeSource,
  MESSAGE_VERBATIM_MASQUE,
  nomAccessibleRenvoi,
  TITRE_SECTION_CITATIONS,
  type AssertionCiteeVue,
  type LivrableCitation,
  type SourceCiteeVue,
} from "../../lib/citations";
import { chargerSourcesLivrable } from "../../lib/citations-serveur";
import { formaterDate } from "../../lib/format";
import { TONALITE_LECTURE } from "../../lib/preuves";
import { obtenirSession } from "../../lib/session";
import "./preuves.css";

function Renvois({
  missionId,
  livrable,
  numeros,
  sources,
  prefixe,
}: {
  missionId: string;
  livrable: LivrableCitation;
  numeros: number[];
  sources: Map<number, SourceCiteeVue>;
  prefixe?: string;
}) {
  if (numeros.length === 0) return null;
  return (
    <span className="mp-citation-renvois">
      {prefixe ? <span>{prefixe} </span> : null}
      {numeros.map((n, i) => {
        const s = sources.get(n);
        return (
          <span key={n}>
            {i > 0 ? ", " : ""}
            <Link
              href={
                s ? hrefOuvertureCitation(missionId, livrable, s.preuve_id) : hrefAncreSource(n)
              }
              aria-label={`${nomAccessibleRenvoi(n, s)} (ouvrir la source)`}
            >
              {formaterRenvois([n])}
            </Link>{" "}
            <a
              href={hrefAncreSource(n)}
              className="mp-citation-ancre"
              aria-label={`Aller à la source ${n} dans la liste`}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                focusable="false"
                aria-hidden="true"
              >
                <path d="M12 5v14M6 13l6 6 6-6" />
              </svg>
            </a>
          </span>
        );
      })}
    </span>
  );
}

function LigneAssertion({
  missionId,
  livrable,
  assertion,
  sources,
}: {
  missionId: string;
  livrable: LivrableCitation;
  assertion: AssertionCiteeVue;
  sources: Map<number, SourceCiteeVue>;
}) {
  const lecture = assertion.solidite?.lecture;
  return (
    <li className="mp-citation-assertion">
      <p className="mp-citation-assertion__enonce">{assertion.enonce}</p>
      <span className="mp-preuve-ligne__meta">
        <BadgeStatut tonalite={lecture ? TONALITE_LECTURE[lecture] : "neutre"}>
          {`Solidité : ${libelleSoliditeCitee(assertion.solidite)}`}
        </BadgeStatut>
        {assertion.avis_expert_signe ? (
          <BadgeStatut tonalite="neutre" sansIcone>
            Avis d&apos;expert signé
          </BadgeStatut>
        ) : null}
      </span>
      {assertion.renvois.pour.length + assertion.renvois.contre.length > 0 ? (
        <p className="mp-texte-petit">
          <Renvois
            missionId={missionId}
            livrable={livrable}
            numeros={assertion.renvois.pour}
            sources={sources}
          />
          {assertion.renvois.pour.length > 0 && assertion.renvois.contre.length > 0 ? " · " : ""}
          <Renvois
            missionId={missionId}
            livrable={livrable}
            numeros={assertion.renvois.contre}
            sources={sources}
            prefixe="contre :"
          />
        </p>
      ) : (
        <p className="mp-texte-doux mp-texte-petit">Aucune source liée.</p>
      )}
    </li>
  );
}

/**
 * Section « Sources et citations » d'un livrable web (PRV-06) : assertions retenues citées par le
 * livrable, avec leur solidité (moteur) et leurs renvois [n] cliquables, puis la liste numérotée
 * des sources. La numérotation est celle de l'annexe « Sources » des exports PDF et Word.
 *
 * N'affiche rien sans `preuve.lire`, sans assertion citée, ni en cas d'erreur de l'API (403, 404,
 * panne) : cette section ne casse jamais la page du livrable. Le droit est revérifié à l'ouverture
 * d'une source par l'API.
 */
export async function CitationsLivrable({
  missionId,
  livrable,
}: {
  missionId: string;
  livrable: LivrableCitation;
}) {
  const { utilisateur } = await obtenirSession();
  if (!aPermission(utilisateur.roles, "preuve.lire")) return null;
  const vue = await chargerSourcesLivrable(missionId, livrable);
  if (!vue || vue.assertions.length === 0) return null;
  const sources = indexerSources(vue.sources);

  return (
    <Carte titre={TITRE_SECTION_CITATIONS} niveauTitre={3} aria-label={TITRE_SECTION_CITATIONS}>
      <div className="mp-pile">
        <ul className="mp-citations-assertions">
          {vue.assertions.map((a) => (
            <LigneAssertion
              key={a.id}
              missionId={missionId}
              livrable={livrable}
              assertion={a}
              sources={sources}
            />
          ))}
        </ul>
        {vue.sources.length > 0 ? (
          <div>
            <h4 className="mp-citations-sous-titre">Sources</h4>
            <ol className="mp-citations-sources">
              {vue.sources.map((s) => (
                <li key={s.numero} id={ancreSource(s.numero)} className="mp-citation-source">
                  <p>
                    <strong>{`[${s.numero}]`}</strong>{" "}
                    <Link href={hrefOuvertureCitation(missionId, livrable, s.preuve_id)}>
                      {s.source_precise}
                    </Link>
                  </p>
                  <p className="mp-texte-doux mp-texte-petit">
                    {`${libelleTypeSource(s.type_source)} · ${formaterDate(s.date_preuve)} · fiabilité ${libelleFiabiliteSource(s.fiabilite)}`}
                  </p>
                  {s.masque ? (
                    <p className="mp-texte-doux mp-preuve-masquee">{MESSAGE_VERBATIM_MASQUE}</p>
                  ) : s.extrait ? (
                    <blockquote className="mp-preuve-extrait">{s.extrait}</blockquote>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </Carte>
  );
}
