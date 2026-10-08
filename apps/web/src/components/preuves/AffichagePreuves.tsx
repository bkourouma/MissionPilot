import Link from "next/link";
import { BadgeStatut } from "../ui/BadgeStatut";
import { formaterDate } from "../../lib/format";
import {
  etatDimension,
  FIABILITES,
  hrefPreuve,
  libelleAuteur,
  libelleDimension,
  matriceTriangulation,
  TYPE_SOURCE_LIBELLES,
  type CarteTriangulationVue,
  type DimensionVue,
  type PreuveVue,
} from "../../lib/preuves";

/** Étiquettes d'une preuve : type de source, fiabilité, nominatif. */
export function EtiquettesPreuve({ preuve }: { preuve: PreuveVue }) {
  return (
    <span className="mp-preuve-ligne__meta">
      <BadgeStatut tonalite="neutre" sansIcone>
        {TYPE_SOURCE_LIBELLES[preuve.type_source]}
      </BadgeStatut>
      <BadgeStatut
        tonalite="neutre"
        sansIcone
      >{`Fiabilité ${FIABILITES[preuve.fiabilite]}`}</BadgeStatut>
      {preuve.nominatif ? (
        <BadgeStatut tonalite={preuve.accord_nominatif ? "succes" : "attention"}>
          {preuve.accord_nominatif ? "Nominatif, accord recueilli" : "Nominatif, sans accord"}
        </BadgeStatut>
      ) : null}
    </span>
  );
}

/** Extrait d'une preuve, ou mention de masquage d'un verbatim nominatif sans accord. */
export function ExtraitPreuve({ preuve }: { preuve: PreuveVue }) {
  if (preuve.masque) {
    return (
      <p className="mp-texte-doux mp-preuve-masquee">
        Verbatim nominatif masqué : l&apos;accord de la personne n&apos;est pas recueilli. Seuls son
        auteur et les responsables de la mission le voient.
      </p>
    );
  }
  if (!preuve.extrait) return null;
  return <blockquote className="mp-preuve-extrait">{preuve.extrait}</blockquote>;
}

export function LignePreuve({
  missionId,
  preuve,
  dimensions,
}: {
  missionId: string;
  preuve: PreuveVue;
  dimensions: readonly DimensionVue[];
}) {
  return (
    <li className="mp-preuve-ligne">
      <h3 className="mp-preuve-ligne__titre">
        <Link href={hrefPreuve(missionId, preuve.id)}>{preuve.source_precise}</Link>
      </h3>
      <EtiquettesPreuve preuve={preuve} />
      <p className="mp-texte-doux mp-texte-petit">
        {formaterDate(preuve.date_preuve)} · recueillie par {libelleAuteur(preuve.auteur)}
        {preuve.version > 1 ? ` · version ${preuve.version}` : ""}
        {preuve.dimensions.length > 0
          ? ` · ${preuve.dimensions.map((c) => libelleDimension(c, dimensions)).join(", ")}`
          : ""}
      </p>
      <ExtraitPreuve preuve={preuve} />
    </li>
  );
}

/** Tableau dimensions × types de source ; les zones non couvertes y sont écrites, pas seulement colorées. */
export function TableauTriangulation({ carte }: { carte: CarteTriangulationVue }) {
  const m = matriceTriangulation(carte);
  return (
    <div className="mp-tableau" role="region" aria-label="Carte de triangulation" tabIndex={0}>
      <table className="mp-triangulation">
        <caption className="mp-visuellement-cache">
          Preuves par dimension et par type de source ; « Non couverte » signale une zone attendue
          sans preuve.
        </caption>
        <thead>
          <tr>
            <th scope="col">Dimension</th>
            {m.types.map((t) => (
              <th key={t} scope="col">
                {TYPE_SOURCE_LIBELLES[t]}
              </th>
            ))}
            <th scope="col">Couverture</th>
          </tr>
        </thead>
        <tbody>
          {m.lignes.map((l) => {
            const etat = etatDimension(l);
            return (
              <tr key={l.code}>
                <th scope="row">{l.libelle}</th>
                {l.cellules.map((c) => (
                  <td
                    key={c.type_source}
                    className={c.non_couverte ? "mp-triangulation__vide" : undefined}
                  >
                    <span className="mp-triangulation__cellule">
                      {c.preuves > 0 ? (
                        <>
                          <span>{`${c.preuves} preuve${c.preuves > 1 ? "s" : ""}`}</span>
                          {c.meilleure_fiabilite ? (
                            <span className="mp-texte-doux mp-texte-petit">
                              {`meilleure fiabilité ${c.meilleure_fiabilite}`}
                            </span>
                          ) : null}
                        </>
                      ) : c.non_couverte ? (
                        <span>Non couverte</span>
                      ) : (
                        <span className="mp-texte-doux">Non attendue</span>
                      )}
                    </span>
                  </td>
                ))}
                <td>
                  <BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
