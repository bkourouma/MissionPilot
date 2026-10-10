import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BoutonAction } from "../../../../components/methodes/BoutonAction";
import { Alerte } from "../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate } from "../../../../lib/format";
import { estIdentifiant } from "../../../../lib/identifiant";
import {
  hrefMethode,
  hrefVersion,
  libelleOrigine,
  peutGerer,
  type MethodeDetail,
} from "../../../../lib/methodes";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Méthode" };

/**
 * Détail d'une méthode : versions (brouillon, publiées, notes de version), héritage du
 * standard (STD-03) et mise à jour du standard proposée à une variante, avec analyse d'impact.
 */
export default async function PageMethode({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("standard.lire");
  const r = await chargerServeur<MethodeDetail>(`/api/methodes/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Méthode" retour={{ href: "/methodes", libelle: "Méthodes" }} />
        <EtatErreur
          titre="La méthode n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefMethode(id)}
        />
      </div>
    );
  }
  const m = r.donnees;
  const gerer = peutGerer(utilisateur.roles);
  const brouillon = m.versions.find((v) => v.statut === "brouillon");
  const publiee = m.versions.find((v) => v.statut === "publiee");

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={m.libelle}
        retour={{ href: "/methodes", libelle: "Méthodes" }}
        soustitre={`${m.service_libelle} · code ${m.code}`}
        badges={
          <BadgeStatut tonalite={m.origine === "standard" ? "neutre" : "succes"}>
            {libelleOrigine(m.origine)}
          </BadgeStatut>
        }
      />
      {m.description ? <p>{m.description}</p> : null}

      {m.origine === "standard" ? (
        <Carte titre="Variante du cabinet">
          {m.variante ? (
            <p>
              Le cabinet adapte cette méthode dans sa variante :{" "}
              <Link href={hrefMethode(m.variante.id)}>{m.variante.libelle}</Link>.
            </p>
          ) : (
            <div className="mp-pile">
              <p>
                Le standard MissionPilot se lit sans se modifier. Pour l&apos;adapter (ajouts,
                pondérations, gabarits à votre charte), créez la variante du cabinet : elle hérite
                de la dernière version publiée, et ses différences restent visibles.
              </p>
              {gerer && publiee ? (
                <BoutonAction
                  libelle="Créer la variante du cabinet"
                  chemin={`/api/methodes/${m.id}/variantes`}
                  variante="primaire"
                  icone="copie"
                  versionDans="version_id"
                />
              ) : null}
            </div>
          )}
        </Carte>
      ) : null}

      {m.parent ? (
        <p>
          Hérite de la méthode du standard{" "}
          <Link href={hrefMethode(m.parent.id)}>{m.parent.libelle}</Link>.
        </p>
      ) : null}

      {m.mise_a_jour_standard ? (
        <Alerte
          tonalite="info"
          titre={`Version ${m.mise_a_jour_standard.disponible.version} du standard disponible`}
        >
          <p>
            La variante part de la version {m.mise_a_jour_standard.base.version}.{" "}
            {m.mise_a_jour_standard.disponible.notes_version ?? ""} Rien ne change sans votre accord
            : analysez l&apos;impact, puis créez une nouvelle version qui reprend le standard en
            gardant vos choix.
          </p>
          {publiee ? (
            <p>
              <Link href={`${hrefVersion(publiee.id)}#mise-a-jour`}>Analyser l&apos;impact</Link>
            </p>
          ) : null}
          {gerer && !brouillon ? (
            <BoutonAction
              libelle="Créer la version mise à jour"
              chemin={`/api/methodes/${m.id}/versions`}
              corps={{ rebaser: true }}
              icone="historique"
              versionDans="id"
            />
          ) : null}
        </Alerte>
      ) : null}

      <Carte titre="Versions">
        <ul className="mp-liste-lignes">
          {m.versions.map((v) => (
            <li key={v.id} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                <Link href={hrefVersion(v.id)} className="mp-lien-ligne">
                  Version {v.version}
                </Link>
                <span className="mp-texte-doux mp-texte-petit">
                  {v.statut === "publiee"
                    ? `Publiée le ${formaterDate(v.publie_le)}${v.publie_par_nom ? ` par ${v.publie_par_nom}` : ""}`
                    : `Brouillon créé le ${formaterDate(v.cree_le)}`}
                  {v.base_standard_version ? ` · base : standard v${v.base_standard_version}` : ""}
                </span>
                {v.notes_version ? <span>{v.notes_version}</span> : null}
              </div>
              <BadgeStatut tonalite={v.statut === "publiee" ? "succes" : "attention"}>
                {v.statut === "publiee" ? "Publiée" : "Brouillon"}
              </BadgeStatut>
            </li>
          ))}
        </ul>
        {gerer && m.origine !== "standard" && !brouillon && publiee ? (
          <BoutonAction
            libelle="Nouvelle version"
            chemin={`/api/methodes/${m.id}/versions`}
            icone="plus"
            versionDans="id"
          />
        ) : null}
      </Carte>
    </div>
  );
}
