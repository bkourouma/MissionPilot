import Link from "next/link";
import { BadgeStatut } from "../ui/BadgeStatut";
import { formaterDate } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import {
  etatDimension,
  hrefPreuve,
  libelleAuteur,
  libelleDimension,
  libelleFiabiliteApi,
  libelleTypeSourcePreuve,
  matriceTriangulation,
  type CarteTriangulationVue,
  type DimensionVue,
  type PreuveVue,
} from "../../lib/preuves";

/** Étiquettes d'une preuve : type de source, fiabilité, nominatif. */
export async function EtiquettesPreuve({ preuve }: { preuve: PreuveVue }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <span className="mp-preuve-ligne__meta">
      <BadgeStatut tonalite="neutre" sansIcone>
        {libelleTypeSourcePreuve(preuve.type_source, langue)}
      </BadgeStatut>
      <BadgeStatut tonalite="neutre" sansIcone>
        {`${t("Fiabilité", "Reliability")} ${libelleFiabiliteApi(preuve.fiabilite, langue)}`}
      </BadgeStatut>
      {preuve.nominatif ? (
        <BadgeStatut tonalite={preuve.accord_nominatif ? "succes" : "attention"}>
          {preuve.accord_nominatif
            ? t("Nominatif, accord recueilli", "Named, consent obtained")
            : t("Nominatif, sans accord", "Named, no consent")}
        </BadgeStatut>
      ) : null}
    </span>
  );
}

/** Extrait d'une preuve, ou mention de masquage d'un verbatim nominatif sans accord. */
export async function ExtraitPreuve({ preuve }: { preuve: PreuveVue }) {
  const t = await obtenirT();
  if (preuve.masque) {
    return (
      <p className="mp-texte-doux mp-preuve-masquee">
        {t(
          "Verbatim nominatif masqué : l'accord de la personne n'est pas recueilli. Seuls son auteur et les responsables de la mission le voient.",
          "Named verbatim hidden: the person's consent has not been obtained. Only its author and the engagement leads can see it.",
        )}
      </p>
    );
  }
  if (!preuve.extrait) return null;
  return <blockquote className="mp-preuve-extrait">{preuve.extrait}</blockquote>;
}

export async function LignePreuve({
  missionId,
  preuve,
  dimensions,
}: {
  missionId: string;
  preuve: PreuveVue;
  dimensions: readonly DimensionVue[];
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <li className="mp-preuve-ligne">
      <h3 className="mp-preuve-ligne__titre">
        <Link href={hrefPreuve(missionId, preuve.id)}>{preuve.source_precise}</Link>
      </h3>
      <EtiquettesPreuve preuve={preuve} />
      <p className="mp-texte-doux mp-texte-petit">
        {formaterDate(preuve.date_preuve, "UTC", langue)} · {t("recueillie par", "collected by")}{" "}
        {libelleAuteur(preuve.auteur, langue)}
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
export async function TableauTriangulation({ carte }: { carte: CarteTriangulationVue }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const m = matriceTriangulation(carte);
  return (
    <div
      className="mp-tableau"
      role="region"
      aria-label={t("Carte de triangulation", "Triangulation map")}
      tabIndex={0}
    >
      <table className="mp-triangulation">
        <caption className="mp-visuellement-cache">
          {t(
            "Preuves par dimension et par type de source ; « Non couverte » signale une zone attendue sans preuve.",
            'Evidence by dimension and source type; "Not covered" flags an expected area with no evidence.',
          )}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t("Dimension", "Dimension")}</th>
            {m.types.map((type) => (
              <th key={type} scope="col">
                {libelleTypeSourcePreuve(type, langue)}
              </th>
            ))}
            <th scope="col">{t("Couverture", "Coverage")}</th>
          </tr>
        </thead>
        <tbody>
          {m.lignes.map((l) => {
            const etat = etatDimension(l, langue);
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
                          <span>
                            {t(
                              `${c.preuves} preuve${c.preuves > 1 ? "s" : ""}`,
                              `${c.preuves} piece${c.preuves > 1 ? "s" : ""} of evidence`,
                            )}
                          </span>
                          {c.meilleure_fiabilite ? (
                            <span className="mp-texte-doux mp-texte-petit">
                              {t(
                                `meilleure fiabilité ${c.meilleure_fiabilite}`,
                                `best reliability ${c.meilleure_fiabilite}`,
                              )}
                            </span>
                          ) : null}
                        </>
                      ) : c.non_couverte ? (
                        <span>{t("Non couverte", "Not covered")}</span>
                      ) : (
                        <span className="mp-texte-doux">{t("Non attendue", "Not expected")}</span>
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
