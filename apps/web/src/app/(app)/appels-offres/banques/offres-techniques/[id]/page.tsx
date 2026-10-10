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
  libelleSection,
  LIBELLES_ORIGINE,
  LIBELLES_STATUT_OFFRE,
  RACINE_BANQUES,
  SECTIONS_OFFRE_TECHNIQUE,
  tonaliteStatutOffre,
  type OffreTechniqueDetail,
} from "../../../../../../lib/banque-ao";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../../lib/format";
import { obtenirSession } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Offre technique" };

/** Offre technique : sections de la dernière version, modification, validation humaine. */
export default async function PageDetailOffreTechnique({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { utilisateur } = await obtenirSession();
  const droits = droitsBanqueAo(utilisateur.roles);
  const r = await chargerServeur<OffreTechniqueDetail>(
    `/api/banque-ao/offres-techniques/${encodeURIComponent(id)}`,
  );
  const retour = { href: `${RACINE_BANQUES}/offres-techniques`, libelle: "Offres techniques" };
  if (!r.ok || !r.donnees.courante) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Offre technique" retour={retour} />
        <EtatErreur
          hrefReessayer={`${RACINE_BANQUES}/offres-techniques/${encodeURIComponent(id)}`}
          titre="Cette offre n'a pas pu être chargée."
          message={r.ok ? "Offre sans version." : r.message}
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
        soustitre={`Version ${v.version} — ${LIBELLES_ORIGINE[v.origine]}, ${formaterDate(v.cree_le)}`}
        retour={retour}
        badges={
          <BadgeStatut tonalite={tonaliteStatutOffre(o.statut)}>
            {LIBELLES_STATUT_OFFRE[o.statut]}
          </BadgeStatut>
        }
      />
      {o.statut !== "validee" ? (
        <Alerte tonalite="attention" titre="À relire et valider">
          Ce contenu n&apos;est pas encore validé : il ne doit pas être transmis au client.
          {v.chiffres_non_verifies
            ? ` Nombres cités par l'IA sans source vérifiée : ${v.nombres_non_verifies.join(", ")}.`
            : ""}
        </Alerte>
      ) : null}
      {SECTIONS_OFFRE_TECHNIQUE.map((cle) => (
        <Carte key={cle} titre={libelleSection(cle)}>
          <p style={{ whiteSpace: "pre-wrap" }}>{v.sections[cle]}</p>
        </Carte>
      ))}
      {droits.gerer && o.statut !== "validee" ? (
        <Carte titre="Valider la dernière version">
          <FormulaireValidationOffre
            offreId={o.id}
            version={v.version}
            nombresAAcquitter={v.chiffres_non_verifies ? v.nombres_non_verifies : []}
            peutValider={o.peut_valider !== false}
          />
        </Carte>
      ) : null}
      {droits.gerer ? (
        <Carte titre="Modifier (nouvelle version)">
          <FormulaireVersionOffre offreId={o.id} sections={v.sections} />
        </Carte>
      ) : null}
      <Carte titre="Historique des versions">
        <ul>
          {o.versions.map((x) => (
            <li key={x.id}>
              Version {x.version} — {LIBELLES_ORIGINE[x.origine]}, {formaterDate(x.cree_le)}
              {x.motif ? ` : ${x.motif}` : ""}
              {x.validation ? ` — validée le ${formaterDate(x.validation.valide_le)}` : ""}
            </li>
          ))}
        </ul>
      </Carte>
    </div>
  );
}
