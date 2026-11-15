import type { Metadata } from "next";
import {
  FormulaireValidationOffre,
  FormulaireVersionOffre,
} from "../../../../../../components/banque-ao/FormulairesOffres";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import {
  droitsBanqueAo,
  libelleOrigine,
  libelleSection,
  libelleStatutOffre,
  RACINE_BANQUES,
  SECTIONS_OFFRE_TECHNIQUE,
  tonaliteStatutOffre,
  type OffreTechniqueDetail,
} from "../../../../../../lib/banque-ao";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { obtenirSession } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Offre technique", "Technical bid") };
}

/** Offre technique : sections de la dernière version, modification, validation humaine. */
export default async function PageDetailOffreTechnique({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { id } = await params;
  const { utilisateur } = await obtenirSession();
  const droits = droitsBanqueAo(utilisateur.roles);
  const r = await chargerServeur<OffreTechniqueDetail>(
    `/api/banque-ao/offres-techniques/${encodeURIComponent(id)}`,
  );
  const retour = {
    href: `${RACINE_BANQUES}/offres-techniques`,
    libelle: t("Offres techniques", "Technical bids"),
  };
  if (!r.ok || !r.donnees.courante) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Offre technique", "Technical bid")} retour={retour} />
        <EtatErreur
          hrefReessayer={`${RACINE_BANQUES}/offres-techniques/${encodeURIComponent(id)}`}
          titre={t("Cette offre n'a pas pu être chargée.", "This bid could not be loaded.")}
          message={r.ok ? t("Offre sans version.", "Bid without a version.") : r.message}
        />
      </div>
    );
  }
  const o = r.donnees;
  const v = o.courante as NonNullable<OffreTechniqueDetail["courante"]>;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={o.titre}
        soustitre={`Version ${v.version} — ${libelleOrigine(v.origine, langue)}, ${formaterDate(v.cree_le, "UTC", langue)}`}
        retour={retour}
        badges={
          <BadgeStatut tonalite={tonaliteStatutOffre(o.statut)}>
            {libelleStatutOffre(o.statut, langue)}
          </BadgeStatut>
        }
      />
      {o.statut !== "validee" ? (
        <Alerte tonalite="attention" titre={t("À relire et valider", "To review and approve")}>
          {t(
            "Ce contenu n'est pas encore validé : il ne doit pas être transmis au client.",
            "This content is not yet approved: it must not be sent to the client.",
          )}
          {v.chiffres_non_verifies
            ? t(
                ` Nombres cités par l'IA sans source vérifiée : ${v.nombres_non_verifies.join(", ")}.`,
                ` Numbers cited by the AI without a verified source: ${v.nombres_non_verifies.join(", ")}.`,
              )
            : ""}
        </Alerte>
      ) : null}
      {SECTIONS_OFFRE_TECHNIQUE.map((cle) => (
        <Carte key={cle} titre={libelleSection(cle, langue)}>
          <p style={{ whiteSpace: "pre-wrap" }}>{v.sections[cle]}</p>
        </Carte>
      ))}
      {droits.gerer && o.statut !== "validee" ? (
        <Carte titre={t("Valider la dernière version", "Approve the latest version")}>
          <FormulaireValidationOffre
            offreId={o.id}
            version={v.version}
            nombresAAcquitter={v.chiffres_non_verifies ? v.nombres_non_verifies : []}
            peutValider={o.peut_valider !== false}
          />
        </Carte>
      ) : null}
      {droits.gerer ? (
        <Carte titre={t("Modifier (nouvelle version)", "Edit (new version)")}>
          <FormulaireVersionOffre offreId={o.id} sections={v.sections} />
        </Carte>
      ) : null}
      <Carte titre={t("Historique des versions", "Version history")}>
        <ul>
          {o.versions.map((x) => (
            <li key={x.id}>
              Version {x.version} — {libelleOrigine(x.origine, langue)},{" "}
              {formaterDate(x.cree_le, "UTC", langue)}
              {x.motif ? ` : ${x.motif}` : ""}
              {x.validation
                ? t(
                    ` — validée le ${formaterDate(x.validation.valide_le)}`,
                    ` — approved on ${formaterDate(x.validation.valide_le, "UTC", langue)}`,
                  )
                : ""}
            </li>
          ))}
        </ul>
      </Carte>
    </div>
  );
}
